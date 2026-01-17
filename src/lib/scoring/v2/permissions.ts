import type { MatchRole, MatchSnapshot } from "@/lib/scoring/v2/types";

export function computeAllowedActions(snapshot: MatchSnapshot, role: MatchRole) {
  const canScoreRole = role === "ADMIN" || role === "ORGANIZER" || role === "SCORER";
  const canManageRole = role === "ADMIN" || role === "ORGANIZER";
  const pending = snapshot.pendingAction;
  const isLive = snapshot.status === "LIVE";
  const isBreak = snapshot.status === "INNINGS_BREAK";
  const isCompleted = snapshot.status === "COMPLETED";
  const locked = Boolean(snapshot.locked);

  return {
    canScore: canScoreRole && isLive && pending === "NONE" && !locked,
    canUndo: canScoreRole && isLive && !locked,
    canSelectBowler: canScoreRole && pending === "SELECT_BOWLER" && isLive && !locked,
    canSelectBatsman: canScoreRole && pending === "SELECT_BATSMAN" && isLive && !locked,
    canStartInnings2: canManageRole && isBreak && pending === "START_INNINGS_2_APPROVAL",
    canEndInnings: canManageRole && isLive && !locked,
    canEndMatch: canManageRole && (isLive || isBreak) && !locked,
    canLockMatch: canManageRole && isCompleted && !locked,
  };
}
