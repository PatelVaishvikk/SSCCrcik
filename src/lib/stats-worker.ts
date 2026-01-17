import type { Db } from "mongodb";
import { isLegalDelivery } from "@/lib/scoring/v2/engine";
import { getMatchConfig, getMatchDoc } from "@/lib/scoring/v2/match";
import { getSnapshotDoc, mapEventDoc } from "@/lib/scoring/v2/store";
import type { MatchSnapshot, ScoreEvent } from "@/lib/scoring/v2/types";

type PlayerBattingStats = {
  innings: number;
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
  outs: number;
  strike_rate: number;
  average: number | null;
};

type PlayerBowlingStats = {
  innings: number;
  balls: number;
  runs: number;
  wickets: number;
  maidens: number;
  economy: number;
  average: number | null;
  strike_rate: number | null;
};

type PlayerFieldingStats = {
  catches: number;
  run_outs: number;
  stumpings: number;
};

export type PlayerMatchStatsDoc = {
  match_id: string;
  tournament_id: string;
  team_id: string | null;
  player_id: string;
  player_name: string;
  match_played: number;
  batting: PlayerBattingStats;
  bowling: PlayerBowlingStats;
  fielding: PlayerFieldingStats;
  updated_at: Date;
};

export type PlayerAggregateStatsDoc = {
  tournament_id?: string | null;
  player_id: string;
  player_name: string;
  team_ids: string[];
  team_names: string[];
  matches: number;
  batting: PlayerBattingStats;
  bowling: PlayerBowlingStats;
  fielding: PlayerFieldingStats;
  updated_at: Date;
};

export type TeamTournamentStatsDoc = {
  tournament_id: string;
  team_id: string;
  team_name: string;
  matches: number;
  wins: number;
  losses: number;
  ties: number;
  no_result: number;
  runs_for: number;
  runs_against: number;
  balls_faced: number;
  balls_bowled: number;
  avg_run_rate: number;
  avg_against_rate: number;
  nrr: number;
  updated_at: Date;
};

export type MatchAnalyticsDoc = {
  match_id: string;
  tournament_id: string;
  innings: Array<{
    innings_no: number;
    batting_team_id: string | null;
    bowling_team_id: string | null;
    totals: {
      runs: number;
      wickets: number;
      balls: number;
      overs: string;
      run_rate: number;
    };
    run_rate: Array<{ over: number; runs: number; run_rate: number }>;
    worm: Array<{ ball: number; over: number; ball_in_over: number; runs: number; wickets: number }>;
    partnerships: Array<{
      batter_ids: [string, string];
      runs: number;
      balls: number;
      start_over: number;
      start_ball: number;
      end_over: number;
      end_ball: number;
      ended_by_wicket: boolean;
      wicket_player_id: string | null;
    }>;
  }>;
  updated_at: Date;
  created_at?: Date;
};

export type TournamentLeaderboardDoc = {
  tournament_id: string;
  updated_at: Date;
  filters: {
    min_balls_strike_rate: number;
    min_balls_economy: number;
  };
  leaderboards: {
    runs: Array<Record<string, any>>;
    wickets: Array<Record<string, any>>;
    strike_rate: Array<Record<string, any>>;
    economy: Array<Record<string, any>>;
  };
};

export type MatchInsightsDoc = {
  match_id: string;
  tournament_id: string;
  turning_point: {
    innings_no: number;
    over: number;
    ball: number;
    runs: number;
    wickets: number;
    swing: number;
    probability_after: number;
    reason: string;
  } | null;
  best_partnership: {
    innings_no: number;
    batter_ids: [string, string];
    batter_names: [string, string];
    runs: number;
    balls: number;
    start_over: number;
    start_ball: number;
    end_over: number;
    end_ball: number;
  } | null;
  chase_probability: {
    target: number;
    timeline: Array<{
      over: number;
      ball: number;
      runs: number;
      wickets: number;
      runs_remaining: number;
      balls_remaining: number;
      required_rr: number;
      current_rr: number;
      probability: number;
    }>;
  } | null;
  potm: {
    player_id: string;
    player_name: string;
    team_id: string | null;
    points: number;
    summary: string;
  } | null;
  updated_at: Date;
  created_at?: Date;
};

export type PlayerAchievementDoc = {
  match_id: string;
  tournament_id: string;
  player_id: string;
  player_name: string;
  team_id: string | null;
  milestones: Array<{ code: string; label: string; value: number }>;
  badges: Array<{ code: string; label: string; description: string }>;
  created_at: Date;
  updated_at: Date;
};

export type TournamentHighlightDoc = {
  highlight_id: string;
  tournament_id: string;
  match_id: string;
  type: string;
  title: string;
  summary: string;
  payload: Record<string, any>;
  created_at: Date;
};

let statsIndexesReady = false;

function buildEmptyBatting(): PlayerBattingStats {
  return {
    innings: 0,
    runs: 0,
    balls: 0,
    fours: 0,
    sixes: 0,
    outs: 0,
    strike_rate: 0,
    average: null,
  };
}

function buildEmptyBowling(): PlayerBowlingStats {
  return {
    innings: 0,
    balls: 0,
    runs: 0,
    wickets: 0,
    maidens: 0,
    economy: 0,
    average: null,
    strike_rate: null,
  };
}

function buildEmptyFielding(): PlayerFieldingStats {
  return { catches: 0, run_outs: 0, stumpings: 0 };
}

function applyDerivedBatting(stats: PlayerBattingStats) {
  stats.strike_rate = stats.balls ? Number(((stats.runs / stats.balls) * 100).toFixed(2)) : 0;
  stats.average = stats.outs ? Number((stats.runs / stats.outs).toFixed(2)) : null;
}

function applyDerivedBowling(stats: PlayerBowlingStats) {
  const overs = stats.balls ? stats.balls / 6 : 0;
  stats.economy = overs ? Number((stats.runs / overs).toFixed(2)) : 0;
  stats.average = stats.wickets ? Number((stats.runs / stats.wickets).toFixed(2)) : null;
  stats.strike_rate = stats.wickets ? Number((stats.balls / stats.wickets).toFixed(2)) : null;
}

function ensurePairKey(strikerId?: string | null, nonStrikerId?: string | null) {
  if (!strikerId || !nonStrikerId) return null;
  const ids = [strikerId, nonStrikerId].sort();
  return { key: ids.join("|"), ids: [ids[0], ids[1]] as [string, string] };
}

function formatOvers(balls: number) {
  const overs = Math.floor(balls / 6);
  const ball = balls % 6;
  return `${overs}.${ball}`;
}

function toNumber(value: unknown, fallback: number) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

async function ensureStatsIndexes(db: Db) {
  if (statsIndexesReady) return;
  await Promise.all([
    db.collection("player_match_stats").createIndex({ match_id: 1, player_id: 1 }),
    db.collection("player_match_stats").createIndex({ tournament_id: 1, player_id: 1 }),
    db.collection("player_tournament_stats").createIndex({ tournament_id: 1, player_id: 1 }, { unique: true }),
    db.collection("player_career_stats").createIndex({ player_id: 1 }, { unique: true }),
    db.collection("team_tournament_stats").createIndex({ tournament_id: 1, team_id: 1 }, { unique: true }),
    db.collection("match_analytics").createIndex({ match_id: 1 }, { unique: true }),
    db.collection("tournament_leaderboards").createIndex({ tournament_id: 1 }, { unique: true }),
  ]);
  statsIndexesReady = true;
}

async function loadTeams(db: Db, match: any) {
  const teamIds = [match.team_a_id, match.team_b_id].filter(Boolean);
  const tournamentId = String(match?.tournament_id || "").trim();
  const teams = await db
    .collection("managed_teams")
    .find(tournamentId ? { tournament_id: tournamentId } : { team_id: { $in: teamIds } })
    .project({ team_id: 1, name: 1, player_ids: 1 })
    .toArray();
  const teamMap = new Map<string, { team_id: string; name: string }>();
  const playerTeamMap = new Map<string, string>();
  teams.forEach((team: any) => {
    teamMap.set(team.team_id, { team_id: team.team_id, name: team.name || team.team_id });
    if (teamIds.includes(team.team_id)) {
      (team.player_ids || []).forEach((playerId: string) => {
        playerTeamMap.set(playerId, team.team_id);
      });
    }
  });
  return { teamMap, playerTeamMap };
}

async function loadPlayersMap(db: Db, playerIds: string[]) {
  const projection: Record<string, number> = { _id: 0 };
  playerIds.forEach((playerId) => {
    projection[`data.players.${playerId}`] = 1;
  });
  const [meta, customPlayers] = await Promise.all([
    playerIds.length
      ? db.collection("meta").findOne({ key: "global_player_database" }, { projection })
      : null,
    playerIds.length
      ? db.collection("custom_players").find({ player_id: { $in: playerIds } }).toArray()
      : [],
  ]);
  const globals = meta?.data?.players || {};
  const map = new Map<string, string>();
  playerIds.forEach((playerId) => {
    const global = globals[playerId];
    if (global?.profile?.name) {
      map.set(playerId, global.profile.name);
    }
  });
  customPlayers.forEach((player: any) => {
    if (player?.player_id && player?.profile?.name) {
      map.set(player.player_id, player.profile.name);
    }
  });
  return map;
}

function initPlayerMatchDoc(params: {
  matchId: string;
  tournamentId: string;
  playerId: string;
  playerName: string;
  teamId: string | null;
}): PlayerMatchStatsDoc {
  return {
    match_id: params.matchId,
    tournament_id: params.tournamentId,
    team_id: params.teamId,
    player_id: params.playerId,
    player_name: params.playerName,
    match_played: 1,
    batting: buildEmptyBatting(),
    bowling: buildEmptyBowling(),
    fielding: buildEmptyFielding(),
    updated_at: new Date(),
  };
}

function updateBatting(doc: PlayerMatchStatsDoc, line: any) {
  const runs = toNumber(line?.runs, 0);
  const balls = toNumber(line?.balls, 0);
  const fours = toNumber(line?.fours, 0);
  const sixes = toNumber(line?.sixes, 0);
  const outs = line?.isOut ? 1 : 0;
  const didBat = runs > 0 || balls > 0 || outs > 0;
  if (didBat) doc.batting.innings += 1;
  doc.batting.runs += runs;
  doc.batting.balls += balls;
  doc.batting.fours += fours;
  doc.batting.sixes += sixes;
  doc.batting.outs += outs;
}

function updateBowling(doc: PlayerMatchStatsDoc, line: any) {
  const runs = toNumber(line?.runs, 0);
  const balls = toNumber(line?.balls, 0);
  const wickets = toNumber(line?.wickets, 0);
  const maidens = toNumber(line?.maidens, 0);
  const didBowl = runs > 0 || balls > 0 || wickets > 0;
  if (didBowl) doc.bowling.innings += 1;
  doc.bowling.runs += runs;
  doc.bowling.balls += balls;
  doc.bowling.wickets += wickets;
  doc.bowling.maidens += maidens;
}

function updateFielding(doc: PlayerMatchStatsDoc, type: string) {
  const norm = type.toLowerCase();
  if (norm.includes("caught")) doc.fielding.catches += 1;
  if (norm.includes("stumped")) doc.fielding.stumpings += 1;
  if (norm.includes("run out")) doc.fielding.run_outs += 1;
}

function finalizePlayerMatch(doc: PlayerMatchStatsDoc) {
  applyDerivedBatting(doc.batting);
  applyDerivedBowling(doc.bowling);
}

function aggregatePlayerStats(
  docs: PlayerMatchStatsDoc[],
  teamMap: Map<string, { team_id: string; name: string }>
): PlayerAggregateStatsDoc[] {
  const agg = new Map<string, PlayerAggregateStatsDoc & { matchIds: Set<string> }>();
  docs.forEach((doc) => {
    if (!agg.has(doc.player_id)) {
      agg.set(doc.player_id, {
        player_id: doc.player_id,
        player_name: doc.player_name,
        team_ids: [],
        team_names: [],
        matches: 0,
        batting: buildEmptyBatting(),
        bowling: buildEmptyBowling(),
        fielding: buildEmptyFielding(),
        updated_at: new Date(),
        matchIds: new Set<string>(),
      } as PlayerAggregateStatsDoc & { matchIds: Set<string> });
    }
    const entry = agg.get(doc.player_id)!;
    entry.matchIds.add(doc.match_id);
    if (doc.team_id) {
      if (!entry.team_ids.includes(doc.team_id)) {
        entry.team_ids.push(doc.team_id);
      }
      const teamName = teamMap.get(doc.team_id)?.name;
      if (teamName && !entry.team_names.includes(teamName)) {
        entry.team_names.push(teamName);
      }
    }
    entry.batting.innings += doc.batting.innings;
    entry.batting.runs += doc.batting.runs;
    entry.batting.balls += doc.batting.balls;
    entry.batting.fours += doc.batting.fours;
    entry.batting.sixes += doc.batting.sixes;
    entry.batting.outs += doc.batting.outs;
    entry.bowling.innings += doc.bowling.innings;
    entry.bowling.runs += doc.bowling.runs;
    entry.bowling.balls += doc.bowling.balls;
    entry.bowling.wickets += doc.bowling.wickets;
    entry.bowling.maidens += doc.bowling.maidens;
    entry.fielding.catches += doc.fielding.catches;
    entry.fielding.run_outs += doc.fielding.run_outs;
    entry.fielding.stumpings += doc.fielding.stumpings;
  });

  const result: PlayerAggregateStatsDoc[] = [];
  agg.forEach((entry) => {
    entry.matches = entry.matchIds.size;
    applyDerivedBatting(entry.batting);
    applyDerivedBowling(entry.bowling);
    const { matchIds, ...rest } = entry;
    result.push(rest);
  });
  return result;
}

function buildLeaderboard(
  stats: PlayerAggregateStatsDoc[],
  minBallsStrikeRate: number,
  minBallsEconomy: number
) {
  const byRuns = [...stats].sort((a, b) => b.batting.runs - a.batting.runs).slice(0, 10);
  const byWickets = [...stats].sort((a, b) => b.bowling.wickets - a.bowling.wickets).slice(0, 10);
  const byStrikeRate = stats
    .filter((item) => item.batting.balls >= minBallsStrikeRate)
    .sort((a, b) => b.batting.strike_rate - a.batting.strike_rate)
    .slice(0, 10);
  const byEconomy = stats
    .filter((item) => item.bowling.balls >= minBallsEconomy)
    .sort((a, b) => a.bowling.economy - b.bowling.economy)
    .slice(0, 10);

  const formatEntry = (item: PlayerAggregateStatsDoc) => ({
    player_id: item.player_id,
    name: item.player_name,
    team_ids: item.team_ids,
    team_names: item.team_names,
    matches: item.matches,
    batting: item.batting,
    bowling: item.bowling,
    fielding: item.fielding,
  });

  return {
    runs: byRuns.map(formatEntry),
    wickets: byWickets.map(formatEntry),
    strike_rate: byStrikeRate.map(formatEntry),
    economy: byEconomy.map(formatEntry),
  };
}

function computeMatchAnalytics(events: ScoreEvent[], config: ReturnType<typeof getMatchConfig>) {
  type Partnership = {
    pairKey: string;
    batterIds: [string, string];
    runs: number;
    balls: number;
    start_over: number;
    start_ball: number;
  };

  type InningsState = {
    innings_no: number;
    batting_team_id: string | null;
    bowling_team_id: string | null;
    runs: number;
    wickets: number;
    balls: number;
    run_rate: Array<{ over: number; runs: number; run_rate: number }>;
    worm: Array<{ ball: number; over: number; ball_in_over: number; runs: number; wickets: number }>;
    partnerships: Array<{
      batter_ids: [string, string];
      runs: number;
      balls: number;
      start_over: number;
      start_ball: number;
      end_over: number;
      end_ball: number;
      ended_by_wicket: boolean;
      wicket_player_id: string | null;
    }>;
    currentPartnership: Partnership | null;
    lastBall: {
      over: number;
      ballInOver: number;
      ballNumber: number;
      isWicket: boolean;
      outPlayerId: string | null;
    } | null;
  };

  const inningsMap = new Map<number, InningsState>();

  const getInnings = (inningsNo: number) => {
    if (!inningsMap.has(inningsNo)) {
      inningsMap.set(inningsNo, {
        innings_no: inningsNo,
        batting_team_id: null,
        bowling_team_id: null,
        runs: 0,
        wickets: 0,
        balls: 0,
        run_rate: [],
        worm: [{ ball: 0, over: 0, ball_in_over: 0, runs: 0, wickets: 0 }],
        partnerships: [],
        currentPartnership: null,
        lastBall: null,
      });
    }
    return inningsMap.get(inningsNo)!;
  };

  const finalizePartnership = (state: InningsState) => {
    if (!state.currentPartnership || !state.lastBall) return;
    const endedByWicket =
      state.lastBall.isWicket &&
      state.currentPartnership.batterIds.includes(state.lastBall.outPlayerId || "");
    state.partnerships.push({
      batter_ids: state.currentPartnership.batterIds,
      runs: state.currentPartnership.runs,
      balls: state.currentPartnership.balls,
      start_over: state.currentPartnership.start_over,
      start_ball: state.currentPartnership.start_ball,
      end_over: state.lastBall.over,
      end_ball: state.lastBall.ballInOver,
      ended_by_wicket: endedByWicket,
      wicket_player_id: endedByWicket ? state.lastBall.outPlayerId : null,
    });
    state.currentPartnership = null;
  };

  events.forEach((event) => {
    const state = getInnings(event.inningsNo);
    if (event.type === "INNINGS_START") {
      state.batting_team_id = event.payload?.battingTeamId || state.batting_team_id;
      state.bowling_team_id = event.payload?.bowlingTeamId || state.bowling_team_id;
      return;
    }

    if (!["BALL_ADDED", "EXTRA", "WICKET"].includes(event.type)) return;

    const payload = event.payload || {};
    const runsOffBat = toNumber(payload.runs, 0);
    const extraRuns = toNumber(payload.extras?.runs, 0);
    const totalRuns = runsOffBat + extraRuns;
    const legal = isLegalDelivery(payload, config);
    const isWicket = event.type === "WICKET" || Boolean(payload.dismissal);
    const outPlayerId = payload.dismissal?.playerOutId || payload.strikerId || null;

    const pair = ensurePairKey(payload.strikerId, payload.nonStrikerId);
    if (pair) {
      if (state.currentPartnership && state.currentPartnership.pairKey !== pair.key) {
        finalizePartnership(state);
      }
      if (!state.currentPartnership) {
        state.currentPartnership = {
          pairKey: pair.key,
          batterIds: pair.ids,
          runs: 0,
          balls: 0,
          start_over: event.over,
          start_ball: event.ballInOver,
        };
      }
    }

    state.runs += totalRuns;
    if (isWicket) state.wickets += 1;
    if (legal) state.balls += 1;

    if (state.currentPartnership && pair && state.currentPartnership.pairKey === pair.key) {
      state.currentPartnership.runs += totalRuns;
      if (legal) state.currentPartnership.balls += 1;
    }

    const ballNumber = state.balls;
    const over = ballNumber ? Math.floor((ballNumber - 1) / 6) : 0;
    const ballInOver = ballNumber ? ((ballNumber - 1) % 6) + 1 : 0;
    state.worm.push({ ball: ballNumber, over, ball_in_over: ballInOver, runs: state.runs, wickets: state.wickets });

    if (legal && ballNumber % 6 === 0) {
      const overNumber = ballNumber / 6;
      const runRate = overNumber ? Number((state.runs / overNumber).toFixed(2)) : 0;
      state.run_rate.push({ over: overNumber, runs: state.runs, run_rate: runRate });
    }

    state.lastBall = {
      over: event.over,
      ballInOver: event.ballInOver,
      ballNumber,
      isWicket,
      outPlayerId,
    };
  });

  inningsMap.forEach((state) => {
    if (state.currentPartnership && state.lastBall) {
      finalizePartnership(state);
    }
  });

  return Array.from(inningsMap.values()).map((state) => ({
    innings_no: state.innings_no,
    batting_team_id: state.batting_team_id,
    bowling_team_id: state.bowling_team_id,
    totals: {
      runs: state.runs,
      wickets: state.wickets,
      balls: state.balls,
      overs: formatOvers(state.balls),
      run_rate: state.balls ? Number((state.runs / (state.balls / 6)).toFixed(2)) : 0,
    },
    run_rate: state.run_rate,
    worm: state.worm,
    partnerships: state.partnerships,
  }));
}

function extractFielding(events: ScoreEvent[], statsMap: Map<string, PlayerMatchStatsDoc>) {
  events.forEach((event) => {
    if (!event.payload?.dismissal?.type) return;
    const fielderId = event.payload.dismissal.fielderId;
    if (!fielderId) return;
    const doc = statsMap.get(fielderId);
    if (!doc) return;
    updateFielding(doc, event.payload.dismissal.type);
  });
}

function buildPlayerMatchStats(params: {
  matchId: string;
  tournamentId: string;
  snapshots: MatchSnapshot[];
  events: ScoreEvent[];
  playerNames: Map<string, string>;
  playerTeamMap: Map<string, string>;
}) {
  const statsMap = new Map<string, PlayerMatchStatsDoc>();
  const ensurePlayer = (playerId: string, teamId: string | null) => {
    if (!statsMap.has(playerId)) {
      statsMap.set(
        playerId,
        initPlayerMatchDoc({
          matchId: params.matchId,
          tournamentId: params.tournamentId,
          playerId,
          playerName: params.playerNames.get(playerId) || playerId,
          teamId,
        })
      );
    }
    const doc = statsMap.get(playerId)!;
    if (!doc.team_id && teamId) {
      doc.team_id = teamId;
    }
    return doc;
  };

  params.snapshots.forEach((snapshot) => {
    const battingTeamId = snapshot.battingTeamId || params.playerTeamMap.get(snapshot.strikerId || "");
    const bowlingTeamId = snapshot.bowlingTeamId || params.playerTeamMap.get(snapshot.bowlerId || "");

    Object.entries(snapshot.batsmen || {}).forEach(([playerId, line]) => {
      const teamId = battingTeamId || params.playerTeamMap.get(playerId) || null;
      const doc = ensurePlayer(playerId, teamId);
      updateBatting(doc, line);
    });

    Object.entries(snapshot.bowlers || {}).forEach(([playerId, line]) => {
      const teamId = bowlingTeamId || params.playerTeamMap.get(playerId) || null;
      const doc = ensurePlayer(playerId, teamId);
      updateBowling(doc, line);
    });
  });

  extractFielding(params.events, statsMap);

  statsMap.forEach((doc) => finalizePlayerMatch(doc));

  return Array.from(statsMap.values());
}

async function recomputeTournamentStats(params: {
  db: Db;
  tournamentId: string;
  teamMap: Map<string, { team_id: string; name: string }>;
}) {
  const matchStats = (await params.db
    .collection<PlayerMatchStatsDoc>("player_match_stats")
    .find({ tournament_id: params.tournamentId })
    .toArray()) as PlayerMatchStatsDoc[];

  const aggregates = aggregatePlayerStats(matchStats, params.teamMap);
  const updatedAt = new Date();

  await params.db.collection("player_tournament_stats").deleteMany({ tournament_id: params.tournamentId });
  if (aggregates.length) {
    await params.db.collection("player_tournament_stats").insertMany(
      aggregates.map((doc) => ({
        ...doc,
        tournament_id: params.tournamentId,
        updated_at: updatedAt,
      }))
    );
  }

  const playerIds = aggregates.map((doc) => doc.player_id);
  if (playerIds.length) {
    const careerMatchStats = (await params.db
      .collection<PlayerMatchStatsDoc>("player_match_stats")
      .find({ player_id: { $in: playerIds } })
      .toArray()) as PlayerMatchStatsDoc[];
    const careerAgg = aggregatePlayerStats(careerMatchStats, params.teamMap);
    const bulk = params.db.collection("player_career_stats").initializeUnorderedBulkOp();
    careerAgg.forEach((doc) => {
      bulk
        .find({ player_id: doc.player_id })
        .upsert()
        .updateOne({ $set: { ...doc, updated_at: updatedAt } });
    });
    if (careerAgg.length) {
      await bulk.execute();
    }
  }

  return aggregates;
}

async function recomputeTeamStats(params: {
  db: Db;
  tournamentId: string;
  teamMap: Map<string, { team_id: string; name: string }>;
}) {
  const matches = await params.db
    .collection("managed_matches")
    .find({ tournament_id: params.tournamentId, status: "completed" })
    .toArray();
  const statsMap = new Map<string, TeamTournamentStatsDoc>();

  const ensureTeam = (teamId: string) => {
    if (!statsMap.has(teamId)) {
      statsMap.set(teamId, {
        tournament_id: params.tournamentId,
        team_id: teamId,
        team_name: params.teamMap.get(teamId)?.name || teamId,
        matches: 0,
        wins: 0,
        losses: 0,
        ties: 0,
        no_result: 0,
        runs_for: 0,
        runs_against: 0,
        balls_faced: 0,
        balls_bowled: 0,
        avg_run_rate: 0,
        avg_against_rate: 0,
        nrr: 0,
        updated_at: new Date(),
      });
    }
    return statsMap.get(teamId)!;
  };

  matches.forEach((match: any) => {
    const result = match.result || {};
    const type = String(result.type || "").toUpperCase();
    const winnerTeamId = result.winner_team_id || null;
    const teamAId = match.team_a_id;
    const teamBId = match.team_b_id;
    const teamAStats = result.team_stats?.[teamAId];
    const teamBStats = result.team_stats?.[teamBId];

    const teamA = ensureTeam(teamAId);
    const teamB = ensureTeam(teamBId);
    teamA.matches += 1;
    teamB.matches += 1;

    if (type === "WIN" && winnerTeamId) {
      const winner = winnerTeamId === teamAId ? teamA : teamB;
      const loser = winnerTeamId === teamAId ? teamB : teamA;
      winner.wins += 1;
      loser.losses += 1;
    } else if (type === "TIE") {
      teamA.ties += 1;
      teamB.ties += 1;
    } else {
      teamA.no_result += 1;
      teamB.no_result += 1;
    }

    if (teamAStats && teamBStats) {
      teamA.runs_for += toNumber(teamAStats.runs, 0);
      teamA.runs_against += toNumber(teamBStats.runs, 0);
      teamA.balls_faced += toNumber(teamAStats.balls, 0);
      teamA.balls_bowled += toNumber(teamBStats.balls, 0);

      teamB.runs_for += toNumber(teamBStats.runs, 0);
      teamB.runs_against += toNumber(teamAStats.runs, 0);
      teamB.balls_faced += toNumber(teamBStats.balls, 0);
      teamB.balls_bowled += toNumber(teamAStats.balls, 0);
    }
  });

  const updatedAt = new Date();
  const docs = Array.from(statsMap.values()).map((team) => {
    const oversFor = team.balls_faced ? team.balls_faced / 6 : 0;
    const oversAgainst = team.balls_bowled ? team.balls_bowled / 6 : 0;
    team.avg_run_rate = oversFor ? Number((team.runs_for / oversFor).toFixed(2)) : 0;
    team.avg_against_rate = oversAgainst ? Number((team.runs_against / oversAgainst).toFixed(2)) : 0;
    team.nrr = Number((team.avg_run_rate - team.avg_against_rate).toFixed(3));
    team.updated_at = updatedAt;
    return team;
  });

  await params.db.collection("team_tournament_stats").deleteMany({ tournament_id: params.tournamentId });
  if (docs.length) {
    await params.db.collection("team_tournament_stats").insertMany(docs);
  }

  return docs;
}

export async function updateMatchStats(params: { db: Db; matchId: string }) {
  const { db, matchId } = params;
  const match = await getMatchDoc(db, matchId);
  if (!match || match.status !== "completed") return null;

  await ensureStatsIndexes(db);

  const tournamentId = match.tournament_id;
  const config = getMatchConfig(match);

  const [innings1Doc, innings2Doc, eventDocs] = await Promise.all([
    getSnapshotDoc(db, matchId, 1),
    getSnapshotDoc(db, matchId, 2),
    db.collection("match_events").find({ match_id: matchId }).sort({ seq: 1 }).toArray(),
  ]);

  const events = eventDocs.map(mapEventDoc) as ScoreEvent[];
  const snapshots = [innings1Doc?.snapshot, innings2Doc?.snapshot].filter(
    (snap): snap is MatchSnapshot => Boolean(snap)
  );

  const playerIds = new Set<string>();
  snapshots.forEach((snapshot) => {
    Object.keys(snapshot.batsmen || {}).forEach((id) => playerIds.add(id));
    Object.keys(snapshot.bowlers || {}).forEach((id) => playerIds.add(id));
  });
  events.forEach((event) => {
    const fielder = event.payload?.dismissal?.fielderId;
    if (fielder) playerIds.add(fielder);
  });

  const { teamMap, playerTeamMap } = await loadTeams(db, match);
  const playerNames = await loadPlayersMap(db, Array.from(playerIds));

  const playerMatchStats = buildPlayerMatchStats({
    matchId,
    tournamentId,
    snapshots,
    events,
    playerNames,
    playerTeamMap,
  });

  await db.collection("player_match_stats").deleteMany({ match_id: matchId });
  if (playerMatchStats.length) {
    await db.collection("player_match_stats").insertMany(playerMatchStats);
  }

  const inningsAnalytics = computeMatchAnalytics(events, config);
  const analyticsDoc: MatchAnalyticsDoc = {
    match_id: matchId,
    tournament_id: tournamentId,
    innings: inningsAnalytics.map((innings) => ({
      ...innings,
      totals: {
        ...innings.totals,
        overs: innings.totals.overs || formatOvers(innings.totals.balls),
        run_rate: innings.totals.run_rate,
      },
    })),
    updated_at: new Date(),
  };

  await db.collection("match_analytics").updateOne(
    { match_id: matchId },
    { $set: analyticsDoc, $setOnInsert: { created_at: new Date() } },
    { upsert: true }
  );

  const tournamentAggregates = await recomputeTournamentStats({
    db,
    tournamentId,
    teamMap,
  });

  await recomputeTeamStats({ db, tournamentId, teamMap });

  const minBallsStrikeRate = 30;
  const minBallsEconomy = 12;
  const leaderboards = buildLeaderboard(tournamentAggregates, minBallsStrikeRate, minBallsEconomy);
  const leaderboardDoc: TournamentLeaderboardDoc = {
    tournament_id: tournamentId,
    updated_at: new Date(),
    filters: {
      min_balls_strike_rate: minBallsStrikeRate,
      min_balls_economy: minBallsEconomy,
    },
    leaderboards,
  };

  await db.collection("tournament_leaderboards").updateOne(
    { tournament_id: tournamentId },
    { $set: leaderboardDoc },
    { upsert: true }
  );

  return {
    analytics: analyticsDoc,
    playerMatchStatsCount: playerMatchStats.length,
    tournamentPlayerStatsCount: tournamentAggregates.length,
  };
}
