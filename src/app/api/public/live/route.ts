import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongo";

export const dynamic = "force-dynamic";

function formatOvers(balls: number) {
  const overs = Math.floor(balls / 6);
  const ball = balls % 6;
  return `${overs}.${ball}`;
}

type BattingStats = {
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
};

type BowlingStats = {
  runs: number;
  balls: number;
  wickets: number;
};

type SnapshotBall = {
  totalRuns: number;
  isWicket: boolean;
  extraType?: string;
};

type SnapshotDoc = {
  match_id: string;
  innings_no: number;
  snapshot: {
    runs: number;
    wickets: number;
    balls: number;
    overs: string;
    runRate: string;
    strikerId: string;
    nonStrikerId: string;
    bowlerId: string;
    batsmen: Record<string, BattingStats & { isOut?: boolean }>;
    bowlers: Record<string, BowlingStats>;
    lastBalls?: SnapshotBall[];
    status: string;
    oversLimit?: number | null;
  };
};

const ILLEGAL_EXTRA_TYPES = new Set(["WD", "NB", "PEN"]);

function mapBattingStats(source: Record<string, any>) {
  const batting = new Map<string, BattingStats>();
  Object.entries(source || {}).forEach(([id, line]) => {
    batting.set(id, {
      runs: Number(line?.runs || 0),
      balls: Number(line?.balls || 0),
      fours: Number(line?.fours || 0),
      sixes: Number(line?.sixes || 0),
    });
  });
  return batting;
}

function mapBowlingStats(source: Record<string, any>) {
  const bowling = new Map<string, BowlingStats>();
  Object.entries(source || {}).forEach(([id, line]) => {
    bowling.set(id, {
      runs: Number(line?.runs || 0),
      balls: Number(line?.balls || 0),
      wickets: Number(line?.wickets || 0),
    });
  });
  return bowling;
}

function resolveTeamAssignments(
  match: any,
  teamMap: Map<string, any>,
  strikerId: string,
  nonStrikerId: string
) {
  const teamAId = String(match?.team_a_id || "");
  const teamBId = String(match?.team_b_id || "");
  if (!teamAId || !teamBId) {
    return { battingTeamId: teamAId, bowlingTeamId: teamBId };
  }

  const teamA = teamMap.get(teamAId);
  const teamB = teamMap.get(teamBId);
  const squadA =
    Array.isArray(match?.squad_a_ids) && match.squad_a_ids.length
      ? match.squad_a_ids
      : teamA?.player_ids || [];
  const squadB =
    Array.isArray(match?.squad_b_ids) && match.squad_b_ids.length
      ? match.squad_b_ids
      : teamB?.player_ids || [];
  const inA = squadA.includes(strikerId) || squadA.includes(nonStrikerId);
  const inB = squadB.includes(strikerId) || squadB.includes(nonStrikerId);

  if (inA && !inB) return { battingTeamId: teamAId, bowlingTeamId: teamBId };
  if (inB && !inA) return { battingTeamId: teamBId, bowlingTeamId: teamAId };
  return { battingTeamId: teamAId, bowlingTeamId: teamBId };
}

function buildLastSixFromSnapshot(lastBalls: SnapshotBall[] | undefined) {
  if (!lastBalls?.length) return { runs: 0, wickets: 0, boundaries: 0, balls: 0 };
  let runs = 0;
  let wickets = 0;
  let boundaries = 0;
  let balls = 0;

  for (let i = lastBalls.length - 1; i >= 0 && balls < 6; i -= 1) {
    const ball = lastBalls[i];
    const totalRuns = Number(ball?.totalRuns || 0);
    const extraType = String(ball?.extraType || "").toUpperCase();
    const legalBall = !ILLEGAL_EXTRA_TYPES.has(extraType);
    runs += totalRuns;
    if (ball?.isWicket) wickets += 1;
    if (totalRuns === 4 || totalRuns === 6) boundaries += 1;
    if (legalBall) balls += 1;
  }

  return { runs, wickets, boundaries, balls };
}

function summarizeLastBalls(events: Array<Record<string, any>>, targetBalls = 6) {
  let runs = 0;
  let wickets = 0;
  let boundaries = 0;
  let balls = 0;

  for (let i = events.length - 1; i >= 0 && balls < targetBalls; i -= 1) {
    const event = events[i];
    const legalBall = event.legalBall !== false;
    const eventRuns = Number(event.runs || 0);
    runs += eventRuns;
    if (event.wicket) wickets += 1;
    if (eventRuns === 4 || eventRuns === 6) boundaries += 1;
    if (legalBall) balls += 1;
  }

  return { runs, wickets, boundaries, balls };
}

function buildAnalysis(
  innings: Record<string, any>,
  allInnings: Array<Record<string, any>>,
  inningsIndex: number,
  oversLimit: number | null
) {
  const events = Array.isArray(innings.events) ? innings.events : [];
  const lastSix = summarizeLastBalls(events, 6);
  const maxBalls = oversLimit ? oversLimit * 6 : null;
  const inningsRuns = Number(innings.runs || 0);
  const inningsBalls = Number(innings.balls || 0);
  const projectedScore =
    maxBalls && inningsBalls > 0 ? Math.round((inningsRuns / inningsBalls) * maxBalls) : null;
  const previous = inningsIndex > 0 ? allInnings[inningsIndex - 1] : null;
  const targetRuns = previous ? Number(previous.runs || 0) + 1 : null;
  const runsNeeded =
    targetRuns !== null ? Math.max(0, targetRuns - inningsRuns) : null;
  const ballsRemaining =
    maxBalls !== null ? Math.max(0, maxBalls - inningsBalls) : null;
  const requiredRate =
    runsNeeded !== null && ballsRemaining && ballsRemaining > 0
      ? (runsNeeded / (ballsRemaining / 6)).toFixed(2)
      : runsNeeded === 0
        ? "0.00"
        : null;

  return {
    overs_limit: oversLimit,
    projected_score: projectedScore,
    last_six: lastSix,
    target: targetRuns,
    runs_needed: runsNeeded,
    balls_remaining: ballsRemaining,
    required_rate: requiredRate,
  };
}

function computeStats(events: Array<Record<string, any>>) {
  const batting = new Map<string, BattingStats>();
  const bowling = new Map<string, BowlingStats>();

  const ensureBatting = (id: string) => {
    if (!batting.has(id)) {
      batting.set(id, { runs: 0, balls: 0, fours: 0, sixes: 0 });
    }
    return batting.get(id) as BattingStats;
  };

  const ensureBowling = (id: string) => {
    if (!bowling.has(id)) {
      bowling.set(id, { runs: 0, balls: 0, wickets: 0 });
    }
    return bowling.get(id) as BowlingStats;
  };

  events.forEach((event) => {
    const strikerId = String(event.striker_id || "").trim();
    const bowlerId = String(event.bowler_id || "").trim();
    const runs = Number(event.runs || 0);
    const legalBall = event.legalBall !== false;
    const wicket = Boolean(event.wicket);

    if (strikerId) {
      const stat = ensureBatting(strikerId);
      if (legalBall) {
        stat.balls += 1;
        stat.runs += runs;
        if (runs === 4) stat.fours += 1;
        if (runs === 6) stat.sixes += 1;
      }
    }

    if (bowlerId) {
      const stat = ensureBowling(bowlerId);
      stat.runs += runs;
      if (legalBall) stat.balls += 1;
      if (wicket) stat.wickets += 1;
    }
  });

  return { batting, bowling };
}

function batterSummary(
  id: string | null | undefined,
  players: Record<string, any>,
  batting: Map<string, BattingStats>
) {
  const safeId = String(id || "").trim();
  const stats = safeId ? batting.get(safeId) : undefined;
  const runs = stats?.runs || 0;
  const balls = stats?.balls || 0;
  const fours = stats?.fours || 0;
  const sixes = stats?.sixes || 0;
  const name = players?.[safeId]?.profile?.name || "TBD";
  const strikeRate = balls ? ((runs / balls) * 100).toFixed(1) : "0.0";
  return {
    player_id: safeId,
    name,
    runs,
    balls,
    fours,
    sixes,
    strike_rate: strikeRate,
  };
}

function bowlerSummary(
  id: string | null | undefined,
  players: Record<string, any>,
  bowling: Map<string, BowlingStats>
) {
  const safeId = String(id || "").trim();
  const stats = safeId ? bowling.get(safeId) : undefined;
  const balls = stats?.balls || 0;
  const runs = stats?.runs || 0;
  const wickets = stats?.wickets || 0;
  const name = players?.[safeId]?.profile?.name || "TBD";
  const overs = formatOvers(balls);
  const economy = balls ? (runs / (balls / 6)).toFixed(2) : "0.00";
  return {
    player_id: safeId,
    name,
    overs,
    runs,
    wickets,
    balls,
    economy,
  };
}

export async function GET() {
  const db = await getDb();
  const snapshotDocs = await db
    .collection<SnapshotDoc>("match_snapshots")
    .find({ "snapshot.status": "live" })
    .sort({ updated_at: -1, innings_no: -1 })
    .toArray();

  if (snapshotDocs.length) {
    const snapshotMap = new Map<string, SnapshotDoc>();
    snapshotDocs.forEach((doc) => {
      const existing = snapshotMap.get(doc.match_id);
      if (!existing || doc.innings_no > existing.innings_no) {
        snapshotMap.set(doc.match_id, doc);
      }
    });

    const matchIds = [...snapshotMap.keys()];
    const matches = await db
      .collection("managed_matches")
      .find({ match_id: { $in: matchIds } })
      .toArray();
    const matchMap = new Map(matches.map((doc: any) => [doc.match_id, doc]));
    const tournamentIds = [...new Set(matches.map((doc: any) => doc.tournament_id))];
    const teamIds = new Set<string>();
    matches.forEach((doc: any) => {
      if (doc.team_a_id) teamIds.add(doc.team_a_id);
      if (doc.team_b_id) teamIds.add(doc.team_b_id);
    });

    const previousQueries = snapshotDocs
      .filter((doc) => doc.innings_no > 1)
      .map((doc) => ({ match_id: doc.match_id, innings_no: doc.innings_no - 1 }));
    const [tournaments, teams, meta, customPlayers, previousSnapshots] = await Promise.all([
      db.collection("managed_tournaments").find({ tournament_id: { $in: tournamentIds } }).toArray(),
      db.collection("managed_teams").find({ team_id: { $in: [...teamIds] } }).toArray(),
      db.collection("meta").findOne({ key: "global_player_database" }),
      db.collection("custom_players").find({}).toArray(),
      previousQueries.length
        ? db
            .collection<SnapshotDoc>("match_snapshots")
            .find({ $or: previousQueries })
            .toArray()
        : Promise.resolve([]),
    ]);

    const tournamentMap = new Map(
      tournaments.map((doc: any) => [doc.tournament_id, doc])
    );
    const teamMap = new Map(teams.map((doc: any) => [doc.team_id, doc]));
    const players = { ...(meta?.data?.players || {}) };
    customPlayers.forEach((player: any) => {
      players[player.player_id] = player;
    });
    const previousMap = new Map(
      (previousSnapshots as SnapshotDoc[]).map((doc) => [
        `${doc.match_id}:${doc.innings_no}`,
        doc,
      ])
    );

    const payload = [...snapshotMap.values()].map((doc) => {
      const snapshot = doc.snapshot;
      const match = matchMap.get(doc.match_id);
      const tournament = tournamentMap.get(match?.tournament_id);
      const { battingTeamId, bowlingTeamId } = resolveTeamAssignments(
        match,
        teamMap,
        snapshot.strikerId,
        snapshot.nonStrikerId
      );
      const battingTeam = teamMap.get(battingTeamId);
      const bowlingTeam = teamMap.get(bowlingTeamId);
      const battingStats = mapBattingStats(snapshot.batsmen || {});
      const bowlingStats = mapBowlingStats(snapshot.bowlers || {});
      const strikerStats = batterSummary(snapshot.strikerId, players, battingStats);
      const nonStrikerStats = batterSummary(snapshot.nonStrikerId, players, battingStats);
      const bowlerStats = bowlerSummary(snapshot.bowlerId, players, bowlingStats);
      const oversLimitRaw = Number(snapshot.oversLimit ?? match?.overs ?? 0);
      const oversLimit = oversLimitRaw > 0 ? oversLimitRaw : null;
      const previousKey = `${doc.match_id}:${doc.innings_no - 1}`;
      const previousDoc = previousMap.get(previousKey);
      const lastSix = buildLastSixFromSnapshot(snapshot.lastBalls);
      const analysis = buildAnalysis(
        { runs: snapshot.runs, balls: snapshot.balls, events: [] },
        previousDoc ? [{ runs: previousDoc.snapshot.runs }, { runs: snapshot.runs }] : [{ runs: snapshot.runs }],
        previousDoc ? 1 : 0,
        oversLimit
      );

      analysis.last_six = lastSix;

      const lastBall = snapshot.lastBalls?.[snapshot.lastBalls.length - 1];
      const lastEvent = lastBall
        ? {
            runs: Number(lastBall.totalRuns || 0),
            wicket: Boolean(lastBall.isWicket),
            extra_type: String(lastBall.extraType || ""),
          }
        : null;

      return {
        match_id: doc.match_id,
        tournament_id: match?.tournament_id || "",
        tournament_name: tournament?.name || "",
        status: snapshot.status || match?.status || "live",
        match_date: match?.match_date || null,
        overs_limit: oversLimit,
        batting: {
          team_id: battingTeamId,
          team_name: battingTeam?.name || "Batting",
          short_name: battingTeam?.short_name || "",
          runs: snapshot.runs || 0,
          wickets: snapshot.wickets || 0,
          balls: snapshot.balls || 0,
          overs: snapshot.overs || formatOvers(snapshot.balls || 0),
          run_rate: snapshot.runRate || "0.00",
          striker_stats: strikerStats,
          non_striker_stats: nonStrikerStats,
        },
        bowling: {
          team_id: bowlingTeamId,
          team_name: bowlingTeam?.name || "Bowling",
          short_name: bowlingTeam?.short_name || "",
          bowler: bowlerStats.name,
          bowler_stats: bowlerStats,
        },
        striker: strikerStats.name,
        non_striker: nonStrikerStats.name,
        last_event: lastEvent,
        analysis,
      };
    });

    return NextResponse.json(
      { matches: payload },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  const liveDocs = await db
    .collection("live_scores")
    .find({ status: { $in: ["live", "innings_break"] } })
    .sort({ last_updated: -1 })
    .toArray();

  if (!liveDocs.length) {
    return NextResponse.json(
      { matches: [] },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  const tournamentIds = [...new Set(liveDocs.map((doc) => doc.tournament_id))];
  const matchIds = [...new Set(liveDocs.map((doc) => doc.match_id))];
  const teamIds = new Set<string>();

  liveDocs.forEach((doc) => {
    const innings = doc.innings?.[doc.current_innings || 0];
    if (innings?.batting_team_id) teamIds.add(innings.batting_team_id);
    if (innings?.bowling_team_id) teamIds.add(innings.bowling_team_id);
  });

  const [tournaments, matches, teams, meta, customPlayers] = await Promise.all([
    db.collection("managed_tournaments").find({ tournament_id: { $in: tournamentIds } }).toArray(),
    db.collection("managed_matches").find({ match_id: { $in: matchIds } }).toArray(),
    db.collection("managed_teams").find({ team_id: { $in: [...teamIds] } }).toArray(),
    db.collection("meta").findOne({ key: "global_player_database" }),
    db.collection("custom_players").find({}).toArray(),
  ]);

  const tournamentMap = new Map(
    tournaments.map((doc: any) => [doc.tournament_id, doc])
  );
  const matchMap = new Map(matches.map((doc: any) => [doc.match_id, doc]));
  const teamMap = new Map(teams.map((doc: any) => [doc.team_id, doc]));
  const players = { ...(meta?.data?.players || {}) };
  customPlayers.forEach((player: any) => {
    players[player.player_id] = player;
  });

  const payload = liveDocs.map((doc: any) => {
    const inningsIndex = Number(doc.current_innings || 0);
    const innings = doc.innings?.[inningsIndex] || {};
    const tournament = tournamentMap.get(doc.tournament_id);
    const match = matchMap.get(doc.match_id);
    const battingTeam = teamMap.get(innings.batting_team_id);
    const bowlingTeam = teamMap.get(innings.bowling_team_id);
    const events = Array.isArray(innings.events) ? innings.events : [];
    const { batting, bowling } = computeStats(events);
    const strikerStats = batterSummary(innings.striker_id, players, batting);
    const nonStrikerStats = batterSummary(innings.non_striker_id, players, batting);
    const bowlerStats = bowlerSummary(innings.bowler_id, players, bowling);
    const runRate =
      innings.balls && innings.balls > 0
        ? (innings.runs / (innings.balls / 6)).toFixed(2)
        : "0.00";
    const lastEvent = innings.events?.[innings.events.length - 1] || null;
    const oversLimitRaw = Number(
      innings.overs || doc.overs || match?.overs || 0
    );
    const oversLimit = oversLimitRaw > 0 ? oversLimitRaw : null;
    const analysis = buildAnalysis(
      innings,
      Array.isArray(doc.innings) ? doc.innings : [],
      inningsIndex,
      oversLimit
    );

    return {
      match_id: doc.match_id,
      tournament_id: doc.tournament_id,
      tournament_name: tournament?.name || "",
      status: doc.status,
      match_date: match?.match_date || null,
      overs_limit: oversLimit,
      batting: {
        team_id: innings.batting_team_id,
        team_name: battingTeam?.name || "Batting",
        short_name: battingTeam?.short_name || "",
        runs: innings.runs || 0,
        wickets: innings.wickets || 0,
        balls: innings.balls || 0,
        overs: formatOvers(innings.balls || 0),
        run_rate: runRate,
        striker_stats: strikerStats,
        non_striker_stats: nonStrikerStats,
      },
      bowling: {
        team_id: innings.bowling_team_id,
        team_name: bowlingTeam?.name || "Bowling",
        short_name: bowlingTeam?.short_name || "",
        bowler: bowlerStats.name,
        bowler_stats: bowlerStats,
      },
      striker: strikerStats.name,
      non_striker: nonStrikerStats.name,
      last_event: lastEvent,
      analysis,
    };
  });

  return NextResponse.json(
    { matches: payload },
    { headers: { "Cache-Control": "no-store" } }
  );
}
