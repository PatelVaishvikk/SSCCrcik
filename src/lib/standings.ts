import type { Db } from "mongodb";
import { formatOvers, getPlayersPerSide } from "@/lib/scoring/v2/engine";
import { getMatchConfig } from "@/lib/scoring/v2/match";
import { getLatestSnapshotDoc, getSnapshotDoc } from "@/lib/scoring/v2/store";
import type { MatchSettings, MatchSnapshot } from "@/lib/scoring/v2/types";

export type TournamentPointsRules = {
  win: number;
  tie: number;
  noResult: number;
  loss: number;
  allOutCountsFullOvers: boolean;
};

export type TournamentBonusRules = {
  enabled: boolean;
  winBonus: number;
  maxBonus: number;
  winMarginRuns?: number | null;
  winMarginWickets?: number | null;
  chaseWithinOvers?: number | null;
};

export type TournamentRules = {
  format: string;
  oversLimit: number | null;
  pointsRules: TournamentPointsRules;
  bonusRules: TournamentBonusRules;
  tieBreakers: string[];
};

export type TeamStanding = {
  tournament_id: string;
  group_id: string | null;
  team_id: string;
  played: number;
  won: number;
  lost: number;
  tied: number;
  no_result: number;
  points: number;
  bonus_points: number;
  runs_for: number;
  runs_against: number;
  balls_faced: number;
  balls_bowled: number;
  nrr: number;
  rank: number;
  updated_at: Date;
};

type MatchDoc = {
  match_id: string;
  tournament_id: string;
  team_a_id: string;
  team_b_id: string;
  status?: string | null;
  overs?: number | null;
  stage?: string | null;
  group_id?: string | null;
  group_name?: string | null;
  counts_for_standings?: boolean | null;
  innings1_batting_team_id?: string | null;
  result?: Record<string, any> | null;
  settings?: MatchSettings;
  squad_a_ids?: string[];
  squad_b_ids?: string[];
};

type TournamentDoc = {
  tournament_id: string;
  format?: string | null;
  overs?: number | null;
  points_rules?: Partial<TournamentPointsRules> | null;
  bonus_rules?: Partial<TournamentBonusRules> | null;
  tie_breakers?: string[] | null;
};

type TeamMatchStats = {
  runs: number;
  wickets: number;
  balls: number;
  overs: string;
  ballsForNRR: number;
};

type MatchResult = {
  matchId: string;
  tournamentId: string;
  groupId: string | null;
  stage: string;
  teamAId: string;
  teamBId: string;
  resultType: "WIN" | "TIE" | "NR";
  winnerTeamId: string | null;
  marginRuns: number | null;
  marginWickets: number | null;
  points: Record<string, number>;
  bonusPoints: Record<string, number>;
  teamStats: Record<string, TeamMatchStats>;
};

const DEFAULT_TIE_BREAKERS = ["POINTS", "NRR", "WINS", "RUNS_FOR"];

function toNumber(value: unknown, fallback: number) {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeRules(tournament?: TournamentDoc | null): TournamentRules {
  const format = String(tournament?.format || "LEAGUE").trim().toUpperCase() || "LEAGUE";
  const oversLimit = tournament?.overs ? toNumber(tournament.overs, 0) : null;
  const points = tournament?.points_rules || {};
  const bonus = tournament?.bonus_rules || {};
  const tieBreakers =
    Array.isArray(tournament?.tie_breakers) && tournament?.tie_breakers?.length
      ? tournament.tie_breakers
      : DEFAULT_TIE_BREAKERS;

  return {
    format,
    oversLimit: oversLimit && oversLimit > 0 ? oversLimit : null,
    pointsRules: {
      win: toNumber(points.win, 2),
      tie: toNumber(points.tie, 1),
      noResult: toNumber(points.noResult ?? (points as any).no_result, 1),
      loss: toNumber(points.loss, 0),
      allOutCountsFullOvers: Boolean(points.allOutCountsFullOvers),
    },
    bonusRules: {
      enabled: Boolean(bonus.enabled),
      winBonus: toNumber(bonus.winBonus, 1),
      maxBonus: toNumber(bonus.maxBonus, 1),
      winMarginRuns: bonus.winMarginRuns ? toNumber(bonus.winMarginRuns, 0) : null,
      winMarginWickets: bonus.winMarginWickets ? toNumber(bonus.winMarginWickets, 0) : null,
      chaseWithinOvers: bonus.chaseWithinOvers ? toNumber(bonus.chaseWithinOvers, 0) : null,
    },
    tieBreakers,
  };
}

function resolveStage(match: MatchDoc, rules: TournamentRules) {
  if (match.stage) return String(match.stage).toUpperCase();
  if (rules.format === "KNOCKOUT") return "KNOCKOUT";
  if (rules.format === "GROUP_KNOCKOUT" && (match.group_id || match.group_name)) return "GROUP";
  return "LEAGUE";
}

function shouldCountMatch(match: MatchDoc, rules: TournamentRules) {
  if (match.counts_for_standings === false) return false;
  const stage = resolveStage(match, rules);
  if (stage === "KNOCKOUT" || stage === "FRIENDLY") return false;
  if (rules.format === "KNOCKOUT") return false;
  return true;
}

function resolveOversLimit(match: MatchDoc, rules: TournamentRules, latest?: MatchSnapshot | null) {
  const matchOvers = match.overs ? toNumber(match.overs, 0) : 0;
  if (matchOvers > 0) return matchOvers;
  if (rules.oversLimit && rules.oversLimit > 0) return rules.oversLimit;
  const snapshotOvers = latest?.oversConfig || 0;
  return snapshotOvers > 0 ? snapshotOvers : null;
}

function resolveInningsStats(
  snapshot: MatchSnapshot | null,
  oversLimit: number | null,
  rules: TournamentRules,
  playersPerSide?: number | null
): { teamId: string; stats: TeamMatchStats } | null {
  if (!snapshot?.battingTeamId) return null;
  const runs = toNumber(snapshot.runs, 0);
  const wickets = toNumber(snapshot.wickets, 0);
  const balls = toNumber(snapshot.balls, 0);
  const overs = snapshot.overs || formatOvers(balls);
  let ballsForNRR = balls;
  const wicketsLimit = playersPerSide && playersPerSide > 1 ? playersPerSide - 1 : 10;
  if (rules.pointsRules.allOutCountsFullOvers && wickets >= wicketsLimit && oversLimit) {
    ballsForNRR = oversLimit * 6;
  }
  return {
    teamId: snapshot.battingTeamId,
    stats: {
      runs,
      wickets,
      balls,
      overs,
      ballsForNRR,
    },
  };
}

function computeBonusPoints(params: {
  bonusRules: TournamentBonusRules;
  winnerTeamId: string | null;
  chasingTeamId: string | null;
  marginRuns: number | null;
  marginWickets: number | null;
  ballsFacedByChasing: number | null;
  oversLimit: number | null;
}) {
  const { bonusRules, winnerTeamId } = params;
  if (!bonusRules.enabled || !winnerTeamId) return 0;

  let bonus = 0;
  if (params.marginRuns !== null && bonusRules.winMarginRuns) {
    if (params.marginRuns >= bonusRules.winMarginRuns) bonus += bonusRules.winBonus;
  }
  if (params.marginWickets !== null && bonusRules.winMarginWickets) {
    if (params.marginWickets >= bonusRules.winMarginWickets) bonus += bonusRules.winBonus;
  }
  if (
    bonusRules.chaseWithinOvers &&
    params.chasingTeamId &&
    params.chasingTeamId === winnerTeamId &&
    params.ballsFacedByChasing !== null
  ) {
    const oversUsed = params.ballsFacedByChasing / 6;
    if (oversUsed <= bonusRules.chaseWithinOvers) bonus += bonusRules.winBonus;
  }

  if (bonusRules.maxBonus > 0) {
    return Math.min(bonus, bonusRules.maxBonus);
  }
  return bonus;
}

function calculateNRR(runsFor: number, ballsFaced: number, runsAgainst: number, ballsBowled: number) {
  if (!ballsFaced || !ballsBowled) return 0;
  const oversFor = ballsFaced / 6;
  const oversAgainst = ballsBowled / 6;
  if (!oversFor || !oversAgainst) return 0;
  const nrr = runsFor / oversFor - runsAgainst / oversAgainst;
  return Number(nrr.toFixed(3));
}

function buildTeamSummary(stats: TeamMatchStats | null) {
  if (!stats) return "";
  return `${stats.runs}/${stats.wickets} (${stats.overs})`;
}

async function fetchSnapshots(db: Db, matchId: string, latestSnapshot?: MatchSnapshot | null) {
  const [innings1Doc, innings2Doc] = await Promise.all([
    getSnapshotDoc(db, matchId, 1),
    getSnapshotDoc(db, matchId, 2),
  ]);
  const latestDoc = latestSnapshot
    ? { snapshot: latestSnapshot }
    : innings2Doc || innings1Doc || (await getLatestSnapshotDoc(db, matchId));
  return {
    innings1: innings1Doc?.snapshot || null,
    innings2: innings2Doc?.snapshot || null,
    latest: latestDoc?.snapshot || null,
  };
}

function resolveMatchResult(params: {
  match: MatchDoc;
  rules: TournamentRules;
  innings1: MatchSnapshot | null;
  innings2: MatchSnapshot | null;
  latest: MatchSnapshot | null;
}): MatchResult | null {
  const { match, rules, innings1, innings2, latest } = params;
  const config = getMatchConfig(match);
  const oversLimit = resolveOversLimit(match, rules, latest);
  const innings1Players = innings1 ? getPlayersPerSide(config, innings1.battingTeamId) : null;
  const innings2Players = innings2 ? getPlayersPerSide(config, innings2.battingTeamId) : null;
  const innings1Stats = resolveInningsStats(innings1, oversLimit, rules, innings1Players);
  const innings2Stats = resolveInningsStats(innings2, oversLimit, rules, innings2Players);

  const teamStats: Record<string, TeamMatchStats> = {};
  if (innings1Stats) teamStats[innings1Stats.teamId] = innings1Stats.stats;
  if (innings2Stats) teamStats[innings2Stats.teamId] = innings2Stats.stats;

  const teamAId = match.team_a_id;
  const teamBId = match.team_b_id;
  const points: Record<string, number> = { [teamAId]: 0, [teamBId]: 0 };
  const bonusPoints: Record<string, number> = { [teamAId]: 0, [teamBId]: 0 };

  let resultType: MatchResult["resultType"] = "NR";
  let winnerTeamId: string | null = null;
  let marginRuns: number | null = null;
  let marginWickets: number | null = null;

  if (innings1Stats && innings2Stats) {
    const runs1 = innings1Stats.stats.runs;
    const runs2 = innings2Stats.stats.runs;
    const chasingTeamId = innings2Stats.teamId;
    const defendingTeamId = innings1Stats.teamId;

    if (runs2 > runs1) {
      resultType = "WIN";
      winnerTeamId = chasingTeamId;
      const wicketsLimit = innings2Players && innings2Players > 1 ? innings2Players - 1 : 10;
      marginWickets = Math.max(wicketsLimit - innings2Stats.stats.wickets, 0);
    } else if (runs2 < runs1) {
      resultType = "WIN";
      winnerTeamId = defendingTeamId;
      marginRuns = Math.max(runs1 - runs2, 0);
    } else {
      resultType = "TIE";
    }

    if (resultType === "WIN" && winnerTeamId) {
      const bonus = computeBonusPoints({
        bonusRules: rules.bonusRules,
        winnerTeamId,
        chasingTeamId,
        marginRuns,
        marginWickets,
        ballsFacedByChasing: innings2Stats.stats.balls,
        oversLimit,
      });
      const loserTeamId = winnerTeamId === teamAId ? teamBId : teamAId;
      points[winnerTeamId] = rules.pointsRules.win + bonus;
      points[loserTeamId] = rules.pointsRules.loss;
      bonusPoints[winnerTeamId] = bonus;
    } else if (resultType === "TIE") {
      points[teamAId] = rules.pointsRules.tie;
      points[teamBId] = rules.pointsRules.tie;
    }
  }

  if (resultType === "NR") {
    points[teamAId] = rules.pointsRules.noResult;
    points[teamBId] = rules.pointsRules.noResult;
  }

  return {
    matchId: match.match_id,
    tournamentId: match.tournament_id,
    groupId: match.group_id || match.group_name || null,
    stage: resolveStage(match, rules),
    teamAId,
    teamBId,
    resultType,
    winnerTeamId,
    marginRuns,
    marginWickets,
    points,
    bonusPoints,
    teamStats,
  };
}

function buildStandings(
  matches: MatchResult[],
  rules: TournamentRules,
  teams: Array<{ team_id: string }>
) {
  const groupMap = new Map<string | null, Map<string, TeamStanding>>();
  const ensureGroup = (groupId: string | null) => {
    if (!groupMap.has(groupId)) {
      groupMap.set(groupId, new Map<string, TeamStanding>());
    }
    return groupMap.get(groupId)!;
  };

  const ensureTeam = (groupId: string | null, teamId: string) => {
    const group = ensureGroup(groupId);
    if (!group.has(teamId)) {
      group.set(teamId, {
        tournament_id: "",
        group_id: groupId,
        team_id: teamId,
        played: 0,
        won: 0,
        lost: 0,
        tied: 0,
        no_result: 0,
        points: 0,
        bonus_points: 0,
        runs_for: 0,
        runs_against: 0,
        balls_faced: 0,
        balls_bowled: 0,
        nrr: 0,
        rank: 0,
        updated_at: new Date(),
      });
    }
    return group.get(teamId)!;
  };

  for (const match of matches) {
    if (match.stage === "KNOCKOUT" || match.stage === "FRIENDLY") continue;
    const groupId = match.groupId || null;
    const teamA = ensureTeam(groupId, match.teamAId);
    const teamB = ensureTeam(groupId, match.teamBId);

    teamA.played += 1;
    teamB.played += 1;

    if (match.resultType === "WIN" && match.winnerTeamId) {
      const loserTeamId = match.winnerTeamId === match.teamAId ? match.teamBId : match.teamAId;
      const winner = match.winnerTeamId === match.teamAId ? teamA : teamB;
      const loser = loserTeamId === match.teamAId ? teamA : teamB;
      winner.won += 1;
      loser.lost += 1;
    } else if (match.resultType === "TIE") {
      teamA.tied += 1;
      teamB.tied += 1;
    } else if (match.resultType === "NR") {
      teamA.no_result += 1;
      teamB.no_result += 1;
    }

    teamA.points += match.points[match.teamAId] || 0;
    teamB.points += match.points[match.teamBId] || 0;
    teamA.bonus_points += match.bonusPoints[match.teamAId] || 0;
    teamB.bonus_points += match.bonusPoints[match.teamBId] || 0;

    if (match.resultType !== "NR") {
      const statsA = match.teamStats[match.teamAId];
      const statsB = match.teamStats[match.teamBId];
      if (statsA && statsB) {
        teamA.runs_for += statsA.runs;
        teamA.runs_against += statsB.runs;
        teamA.balls_faced += statsA.ballsForNRR;
        teamA.balls_bowled += statsB.ballsForNRR;

        teamB.runs_for += statsB.runs;
        teamB.runs_against += statsA.runs;
        teamB.balls_faced += statsB.ballsForNRR;
        teamB.balls_bowled += statsA.ballsForNRR;
      }
    }
  }

  const result: TeamStanding[] = [];
  for (const [groupId, standingsMap] of groupMap.entries()) {
    const list = Array.from(standingsMap.values());
    list.forEach((entry) => {
      entry.nrr = calculateNRR(
        entry.runs_for,
        entry.balls_faced,
        entry.runs_against,
        entry.balls_bowled
      );
    });

    list.sort((a, b) => {
      for (const key of rules.tieBreakers) {
        const upper = String(key || "").toUpperCase();
        if (upper === "POINTS" && a.points !== b.points) return b.points - a.points;
        if (upper === "NRR" && a.nrr !== b.nrr) return b.nrr - a.nrr;
        if (upper === "WINS" && a.won !== b.won) return b.won - a.won;
        if (upper === "RUNS_FOR" && a.runs_for !== b.runs_for) return b.runs_for - a.runs_for;
      }
      return a.team_id.localeCompare(b.team_id);
    });

    list.forEach((entry, index) => {
      entry.rank = index + 1;
      entry.group_id = groupId;
      entry.updated_at = new Date();
      result.push(entry);
    });
  }

  for (const team of teams) {
    if (!team?.team_id) continue;
    const group = ensureGroup(null);
    if (!group.has(team.team_id)) {
      result.push({
        tournament_id: "",
        group_id: null,
        team_id: team.team_id,
        played: 0,
        won: 0,
        lost: 0,
        tied: 0,
        no_result: 0,
        points: 0,
        bonus_points: 0,
        runs_for: 0,
        runs_against: 0,
        balls_faced: 0,
        balls_bowled: 0,
        nrr: 0,
        rank: 0,
        updated_at: new Date(),
      });
    }
  }

  return result;
}

async function upsertMatchResult(db: Db, match: MatchDoc, result: MatchResult) {
  const statsA = result.teamStats[match.team_a_id] || null;
  const statsB = result.teamStats[match.team_b_id] || null;
  const update: Record<string, any> = {
    result: {
      type: result.resultType,
      winner_team_id: result.winnerTeamId,
      margin_runs: result.marginRuns,
      margin_wickets: result.marginWickets,
      points: result.points,
      bonus_points: result.bonusPoints,
      team_stats: result.teamStats,
      updated_at: new Date(),
    },
  };
  const teamASummary = buildTeamSummary(statsA);
  const teamBSummary = buildTeamSummary(statsB);
  if (teamASummary) update.team_a_summary = teamASummary;
  if (teamBSummary) update.team_b_summary = teamBSummary;

  await db.collection("managed_matches").updateOne(
    { match_id: match.match_id },
    { $set: update }
  );
}

export async function updateTournamentStandings(params: {
  db: Db;
  matchId: string;
  latestSnapshot?: MatchSnapshot | null;
}) {
  const { db, matchId } = params;
  const match = (await db
    .collection<MatchDoc>("managed_matches")
    .findOne({ match_id: matchId })) as MatchDoc | null;
  if (!match || match.status !== "completed") return null;

  const tournament = (await db
    .collection<TournamentDoc>("managed_tournaments")
    .findOne({ tournament_id: match.tournament_id })) as TournamentDoc | null;
  if (!tournament) return null;

  const rules = normalizeRules(tournament);

  const snapshots = await fetchSnapshots(db, match.match_id, params.latestSnapshot || null);
  const result = resolveMatchResult({
    match,
    rules,
    innings1: snapshots.innings1,
    innings2: snapshots.innings2,
    latest: snapshots.latest,
  });
  if (!result) return null;

  await upsertMatchResult(db, match, result);
  if (!shouldCountMatch(match, rules)) return null;

  const completedMatches = await db
    .collection<MatchDoc>("managed_matches")
    .find({ tournament_id: match.tournament_id, status: "completed" })
    .toArray();
  const teamDocs = await db
    .collection("managed_teams")
    .find({ tournament_id: match.tournament_id })
    .project({ team_id: 1 })
    .toArray();

  const matchResults: MatchResult[] = [];
  for (const entry of completedMatches) {
    if (!shouldCountMatch(entry, rules)) continue;
    if (entry.result?.team_stats) {
      matchResults.push({
        matchId: entry.match_id,
        tournamentId: entry.tournament_id,
        groupId: entry.group_id || entry.group_name || null,
        stage: resolveStage(entry, rules),
        teamAId: entry.team_a_id,
        teamBId: entry.team_b_id,
        resultType: entry.result?.type || "NR",
        winnerTeamId: entry.result?.winner_team_id || null,
        marginRuns: entry.result?.margin_runs ?? null,
        marginWickets: entry.result?.margin_wickets ?? null,
        points: entry.result?.points || {},
        bonusPoints: entry.result?.bonus_points || {},
        teamStats: entry.result?.team_stats || {},
      });
      continue;
    }
    const snap = await fetchSnapshots(db, entry.match_id);
    const computed = resolveMatchResult({
      match: entry,
      rules,
      innings1: snap.innings1,
      innings2: snap.innings2,
      latest: snap.latest,
    });
    if (computed) {
      matchResults.push(computed);
      await upsertMatchResult(db, entry, computed);
    }
  }

  const standings = buildStandings(matchResults, rules, teamDocs as Array<{ team_id: string }>);
  const updatedAt = new Date();
  const docs = standings.map((row) => ({
    ...row,
    tournament_id: match.tournament_id,
    updated_at: updatedAt,
  }));

  await db.collection("tournament_standings").deleteMany({ tournament_id: match.tournament_id });
  if (docs.length) {
    await db.collection("tournament_standings").insertMany(docs);
  }

  return { standings: docs };
}
