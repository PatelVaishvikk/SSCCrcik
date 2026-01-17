import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongo";
import { isLegalDelivery, type ScoringPayload } from "@/lib/scoring/engine";

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

type SnapshotDoc = {
  match_id: string;
  innings_no: number;
  snapshot: {
    matchId: string;
    inningsNo: number;
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
    lastBalls?: Array<{ totalRuns: number; isWicket: boolean; extraType?: string }>;
    status: string;
    runsPerOver?: number[];
    oversLimit?: number | null;
  };
  initial?: {
    strikerId: string;
    nonStrikerId: string;
    bowlerId: string;
    oversLimit?: number | null;
  };
  updated_at?: Date;
};

type MatchEventDoc = {
  match_id: string;
  innings_no: number;
  seq: number;
  type: string;
  payload: ScoringPayload;
  created_at?: Date | null;
  target_seq?: number;
};

type AppliedEvent = {
  runs: number;
  wicket: boolean;
  legalBall: boolean;
  extra_type?: string;
  striker_id?: string;
  bowler_id?: string;
  striker_name?: string;
  bowler_name?: string;
  timestamp?: string | null;
};

const EVENT_SKIP_TYPES = new Set(["UNDO", "EDIT", "INNINGS_END"]);

function buildPlayersMap(meta: any, customPlayers: any[]) {
  const players = { ...(meta?.data?.players || {}) };
  customPlayers.forEach((player: any) => {
    players[player.player_id] = player;
  });
  return players;
}

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

function buildAppliedEvents(eventDocs: MatchEventDoc[], players: Record<string, any>) {
  const voided = new Set<number>();
  const overrides = new Map<number, MatchEventDoc>();
  eventDocs.forEach((doc) => {
    if (doc.type === "UNDO" && doc.target_seq) {
      voided.add(doc.target_seq);
    }
    if (doc.type === "EDIT" && doc.target_seq) {
      overrides.set(doc.target_seq, doc);
    }
  });

  const applied: AppliedEvent[] = [];
  eventDocs.forEach((doc) => {
    if (EVENT_SKIP_TYPES.has(doc.type)) return;
    if (voided.has(doc.seq)) return;
    const override = overrides.get(doc.seq);
    const payload = override?.payload || doc.payload || {};
    const type = override
      ? payload?.dismissal
        ? "WICKET"
        : payload?.extras
          ? "EXTRA"
          : "BALL_ADDED"
      : doc.type;
    const runsOffBat = Number(payload.runs || 0);
    const extraRuns = Number(payload.extras?.runs || 0);
    const totalRuns = runsOffBat + extraRuns;
    const legalBall = isLegalDelivery(payload as ScoringPayload);
    const wicket = type === "WICKET" || Boolean(payload.dismissal);
    const extraType = payload.extras?.type ? String(payload.extras.type) : "";
    const strikerId = String(payload.strikerId || "");
    const bowlerId = String(payload.bowlerId || "");
    applied.push({
      runs: totalRuns,
      wicket,
      legalBall,
      extra_type: extraType,
      striker_id: strikerId,
      bowler_id: bowlerId,
      striker_name: players?.[strikerId]?.profile?.name || "TBD",
      bowler_name: players?.[bowlerId]?.profile?.name || "TBD",
      timestamp: doc.created_at ? doc.created_at.toISOString() : null,
    });
  });

  return applied;
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
    runsPerOver: innings.runsPerOver || [],
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

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ matchId: string }> }
) {
  const { matchId } = await params;
  const db = await getDb();
  const snapshotDoc = await db
    .collection<SnapshotDoc>("match_snapshots")
    .findOne({ match_id: matchId }, { sort: { innings_no: -1 } });

  if (snapshotDoc?.snapshot) {
    const snapshot = snapshotDoc.snapshot;
    const [match, meta, customPlayers, eventDocs, previousSnapshot] = await Promise.all([
      db.collection("managed_matches").findOne({ match_id: matchId }),
      db.collection("meta").findOne({ key: "global_player_database" }),
      db.collection("custom_players").find({}).toArray(),
      db
        .collection<MatchEventDoc>("match_events")
        .find({ match_id: matchId, innings_no: snapshotDoc.innings_no })
        .sort({ seq: 1 })
        .toArray(),
      snapshotDoc.innings_no > 1
        ? db
          .collection<SnapshotDoc>("match_snapshots")
          .findOne({ match_id: matchId, innings_no: snapshotDoc.innings_no - 1 })
        : Promise.resolve(null),
    ]);

    const [tournament, teams] = match
      ? await Promise.all([
        db.collection("managed_tournaments").findOne({ tournament_id: match.tournament_id }),
        db
          .collection("managed_teams")
          .find({ team_id: { $in: [match.team_a_id, match.team_b_id] } })
          .toArray(),
      ])
      : [null, []];

    // Auto-heal logic if runsPerOver is missing
    if (!snapshot.runsPerOver) {
      console.log(`[PublicLive] Rebuilding snapshot for ${matchId} to add runsPerOver...`);
      const { persistSnapshot } = await import("@/lib/scoring/v2/store");
      const { applyEvent, buildInitialSnapshot } = await import("@/lib/scoring/v2/engine");
      // const { mapEventDoc } = await import("@/lib/scoring/v2/store"); // Removed as no longer used

      // Use loaded eventDocs
      let freshSnapshot = buildInitialSnapshot({
        matchId,
        inningsNo: snapshotDoc.innings_no,
        oversConfig: (snapshot.oversLimit ?? 20) as number,
        settings: {},
        battingTeamId: "TBD", // Temporary placeholders, will be resolved by events or engine
        bowlingTeamId: "TBD",
        strikerId: "TBD",
        nonStrikerId: "TBD",
        bowlerId: "TBD",
      });

      // mapEventDoc expects ScoreEventDoc properties. MatchEventDoc is a subset.
      // We will manually map for the replay engine.
      const mappedEvents = eventDocs.map((doc: any) => ({
        ...doc,
        matchId: doc.match_id,
        inningsNo: doc.innings_no,
        over: doc.payload?.over ?? 0, // Fallback if missing
        ballInOver: doc.payload?.ballInOver ?? 0,
        type: doc.type,
        payload: doc.payload || {},
        createdBy: "system",
        createdAt: doc.created_at ? new Date(doc.created_at).toISOString() : new Date().toISOString(),
        idempotencyKey: doc.idempotency_key || `replay_${doc.seq}`,
      }));

      for (const event of mappedEvents) {
        freshSnapshot = applyEvent({
          snapshot: freshSnapshot,
          event: event as any,
          config: {
            overs: (snapshot.oversLimit ?? 20) as number,
            settings: {}
          },
          scorer: { id: "system", name: "System" }
        });
      }

      await persistSnapshot(db, {
        match_id: matchId,
        innings_no: snapshotDoc.innings_no,
        snapshot: freshSnapshot,
        last_event_seq: mappedEvents.length > 0 ? mappedEvents[mappedEvents.length - 1].seq : 0,
      });
      snapshot.runsPerOver = freshSnapshot.runsPerOver;
      if (freshSnapshot.runsPerOver) {
        // Also update the local snapshot object reference if needed
        Object.assign(snapshot, { runsPerOver: freshSnapshot.runsPerOver });
      }
    }

    const teamMap = new Map(teams.map((team: any) => [team.team_id, team]));
    const players = buildPlayersMap(meta, customPlayers as any[]);
    const appliedEvents = buildAppliedEvents(eventDocs, players);

    const battingMap = mapBattingStats(snapshot.batsmen || {});
    const bowlingMap = mapBowlingStats(snapshot.bowlers || {});
    const strikerStats = batterSummary(snapshot.strikerId, players, battingMap);
    const nonStrikerStats = batterSummary(snapshot.nonStrikerId, players, battingMap);
    const bowlerStats = bowlerSummary(snapshot.bowlerId, players, bowlingMap);

    const oversLimitRaw = Number(snapshot.oversLimit ?? match?.overs ?? 0);
    const oversLimit = oversLimitRaw > 0 ? oversLimitRaw : null;
    const inningsData = {
      runs: snapshot.runs,
      balls: snapshot.balls,
      events: appliedEvents,
    };
    const previousInnings = previousSnapshot ? { runs: previousSnapshot.snapshot.runs } : null;
    const analysis = buildAnalysis(
      inningsData,
      previousInnings ? [previousInnings, inningsData] : [inningsData],
      previousInnings ? 1 : 0,
      oversLimit
    );

    const { battingTeamId, bowlingTeamId } = resolveTeamAssignments(
      match,
      teamMap,
      snapshot.strikerId,
      snapshot.nonStrikerId
    );
    const battingTeam = teamMap.get(battingTeamId);
    const bowlingTeam = teamMap.get(bowlingTeamId);

    const recentEvents = appliedEvents.slice(-12);
    const lastEvent = recentEvents.length
      ? {
        runs: recentEvents[recentEvents.length - 1].runs,
        wicket: recentEvents[recentEvents.length - 1].wicket,
        extra_type: recentEvents[recentEvents.length - 1].extra_type,
      }
      : null;

    const payload = {
      match_id: matchId,
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
      analysis: {
        ...analysis,
        runsPerOver: snapshot.runsPerOver || [] // Fallback if analysis didn't catch it
      },
      recent_events: recentEvents,
    };

    return NextResponse.json(
      { match: payload },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  const liveDoc = await db.collection("live_scores").findOne({ match_id: matchId });

  if (!liveDoc) {
    return NextResponse.json({ error: "Live match not found." }, { status: 404 });
  }

  const inningsIndex = Number(liveDoc.current_innings || 0);
  const innings = liveDoc.innings?.[inningsIndex] || {};
  const [tournament, match, teams, meta, customPlayers] = await Promise.all([
    db.collection("managed_tournaments").findOne({ tournament_id: liveDoc.tournament_id }),
    db.collection("managed_matches").findOne({ match_id: liveDoc.match_id }),
    db
      .collection("managed_teams")
      .find({ team_id: { $in: [innings.batting_team_id, innings.bowling_team_id] } })
      .toArray(),
    db.collection("meta").findOne({ key: "global_player_database" }),
    db.collection("custom_players").find({}).toArray(),
  ]);

  const teamMap = new Map(teams.map((team: any) => [team.team_id, team]));
  const players = { ...(meta?.data?.players || {}) };
  customPlayers.forEach((player: any) => {
    players[player.player_id] = player;
  });

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
  const oversLimitRaw = Number(
    innings.overs || liveDoc.overs || match?.overs || 0
  );
  const oversLimit = oversLimitRaw > 0 ? oversLimitRaw : null;
  const analysis = buildAnalysis(
    innings,
    Array.isArray(liveDoc.innings) ? liveDoc.innings : [],
    inningsIndex,
    oversLimit
  );

  const payload = {
    match_id: liveDoc.match_id,
    tournament_id: liveDoc.tournament_id,
    tournament_name: tournament?.name || "",
    status: liveDoc.status,
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
    last_event: innings.events?.[innings.events.length - 1] || null,
    analysis,
    recent_events: (innings.events || []).slice(-12).map((event: any) => ({
      runs: Number(event.runs || 0),
      wicket: Boolean(event.wicket),
      legalBall: event.legalBall !== false,
      extra_type: String(event.extra_type || "").trim(),
      striker_id: String(event.striker_id || ""),
      bowler_id: String(event.bowler_id || ""),
      striker_name: players?.[event.striker_id]?.profile?.name || "TBD",
      bowler_name: players?.[event.bowler_id]?.profile?.name || "TBD",
      timestamp: event.timestamp || null,
    })),
  };

  return NextResponse.json(
    { match: payload },
    { headers: { "Cache-Control": "no-store" } }
  );
}
