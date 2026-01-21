import type { Db } from "mongodb";
import type { MatchConfig, MatchSettings } from "@/lib/scoring/v2/types";

export type MatchDoc = {
  match_id: string;
  tournament_id: string;
  team_a_id: string;
  team_b_id: string;
  overs?: number | null;
  status?: string | null;
  toss_winner_id?: string | null;
  toss_decision?: "bat" | "bowl" | null;
  squad_a_ids?: string[];
  squad_b_ids?: string[];
  settings?: MatchSettings;
  innings1_batting_team_id?: string | null;
  innings1_bowling_team_id?: string | null;
  current_innings?: number | null;
};

export async function getMatchDoc(db: Db, matchId: string) {
  return (await db
    .collection<MatchDoc>("managed_matches")
    .findOne({ match_id: matchId })) as MatchDoc | null;
}

export function getMatchConfig(match: MatchDoc): MatchConfig {
  const settings: MatchSettings = match.settings || {};

  const sizeA = match.squad_a_ids?.length || 0;
  const sizeB = match.squad_b_ids?.length || 0;

  const impliedA = sizeA > 11 ? 11 : (sizeA || 11);
  const impliedB = sizeB > 11 ? 11 : (sizeB || 11);

  return {
    overs: Number(match.overs || 0),
    settings: {
      noConsecutiveBowler: Boolean(settings.noConsecutiveBowler),
      countWideAsBall: Boolean(settings.countWideAsBall),
      countNoBallAsBall: Boolean(settings.countNoBallAsBall),
      playersPerSide: settings.playersPerSide,
    },
    teamAId: match.team_a_id,
    teamBId: match.team_b_id,
    playersPerSideA: settings.playersPerSide || impliedA,
    playersPerSideB: settings.playersPerSide || impliedB,
  };
}

export function validateMatchSetup(match: MatchDoc) {
  const errors: string[] = [];
  if (!match.overs) errors.push("Match overs are not configured.");
  if (!match.toss_winner_id || !match.toss_decision) {
    errors.push("Toss winner and decision are required.");
  }
  if (!match.squad_a_ids?.length || !match.squad_b_ids?.length) {
    errors.push("Playing XI must be selected for both teams.");
  }
  return errors;
}

export function isPlayerInXI(match: MatchDoc, teamId: string, playerId: string) {
  const ids =
    teamId === match.team_a_id
      ? match.squad_a_ids || []
      : teamId === match.team_b_id
        ? match.squad_b_ids || []
        : [];
  return ids.includes(playerId);
}
