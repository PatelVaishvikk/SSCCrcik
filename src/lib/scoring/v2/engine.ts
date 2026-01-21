import type {
  BallSummary,
  CommentaryEntry,
  MatchConfig,
  MatchSnapshot,
  MatchStatus,
  ScoreEvent,
  ScoreEventPayload,
  ScoreEventType,
} from "@/lib/scoring/v2/types";
import { generateAutoCommentary } from "@/lib/scoring/v2/commentary";

const ILLEGAL_EXTRAS = new Set(["WD", "NB", "PEN"]);
const NON_BOWLER_EXTRAS = new Set(["B", "LB", "PEN"]);
const NON_BOWLER_WICKETS = new Set([
  "run out",
  "retired",
  "retired hurt",
  "retired out",
  "obstructing field",
]);

export function formatOvers(balls: number) {
  const overs = Math.floor(balls / 6);
  const ball = balls % 6;
  return `${overs}.${ball}`;
}

export function formatRunRate(runs: number, balls: number) {
  if (!balls) return "0.00";
  return (runs / (balls / 6)).toFixed(2);
}

export function getNextBallLabel(balls: number) {
  const over = Math.floor(balls / 6);
  const ballInOver = (balls % 6) + 1;
  return { over, ballInOver, label: `${over}.${ballInOver}` };
}

export function isLegalDelivery(payload: ScoreEventPayload, config: MatchConfig) {
  const extraType = payload.extras?.type;
  if (!extraType) return true;
  if (!ILLEGAL_EXTRAS.has(extraType)) return true;
  if (extraType === "WD") return Boolean(config.settings.countWideAsBall);
  if (extraType === "NB") return Boolean(config.settings.countNoBallAsBall);
  return false;
}

export function buildInitialSnapshot(params: {
  matchId: string;
  inningsNo: number;
  strikerId: string;
  nonStrikerId: string;
  bowlerId: string;
  battingTeamId: string;
  bowlingTeamId: string;
  oversConfig: number;
  settings: MatchConfig["settings"];
  previousInnings?: MatchSnapshot["previousInnings"];
  target?: number | null;
}): MatchSnapshot {
  return {
    matchId: params.matchId,
    inningsNo: params.inningsNo,
    version: 0,
    status: "LIVE",
    oversConfig: params.oversConfig,
    settings: params.settings,
    balls: 0,
    overs: "0.0",
    runs: 0,
    wickets: 0,
    runRate: "0.00",
    target: params.target ?? null,
    requiredRR: null,
    strikerId: params.strikerId,
    nonStrikerId: params.nonStrikerId,
    bowlerId: params.bowlerId,
    battingTeamId: params.battingTeamId,
    bowlingTeamId: params.bowlingTeamId,
    batsmen: {},
    bowlers: {},
    currentOverBalls: [],
    last12Balls: [],
    commentaryTail: [],
    pendingAction: "NONE",
    pendingBatsmanSlot: null,
    pendingBowlerAfterBatsman: false,
    inningsSummary: null,
    previousInnings: params.previousInnings ?? null,
    lastOverBowlerId: null,
    legalBallsInOver: 0,
    overRuns: 0,
    scorer: null,
    matchResult: null,
    locked: false,
    runsPerOver: [],
  };
}

function cloneSnapshot(snapshot: MatchSnapshot): MatchSnapshot {
  return {
    ...snapshot,
    batsmen: { ...snapshot.batsmen },
    bowlers: { ...snapshot.bowlers },
    last12Balls: [...snapshot.last12Balls],
    commentaryTail: [...snapshot.commentaryTail],
    runsPerOver: [...(snapshot.runsPerOver || [])],
  };
}

function getBattingLine(snapshot: MatchSnapshot, playerId: string) {
  const existing = snapshot.batsmen[playerId];
  if (!existing) {
    snapshot.batsmen[playerId] = { runs: 0, balls: 0, fours: 0, sixes: 0 };
    return snapshot.batsmen[playerId];
  }
  if (snapshot.batsmen[playerId] === existing) {
    snapshot.batsmen[playerId] = { ...existing };
  }
  return snapshot.batsmen[playerId];
}

function getBowlingLine(snapshot: MatchSnapshot, playerId: string) {
  const existing = snapshot.bowlers[playerId];
  if (!existing) {
    snapshot.bowlers[playerId] = { runs: 0, balls: 0, wickets: 0, maidens: 0 };
    return snapshot.bowlers[playerId];
  }
  if (snapshot.bowlers[playerId] === existing) {
    snapshot.bowlers[playerId] = { ...existing };
  }
  return snapshot.bowlers[playerId];
}

function shouldCreditBowler(dismissal?: ScoreEventPayload["dismissal"]) {
  if (!dismissal?.type) return false;
  return !NON_BOWLER_WICKETS.has(dismissal.type.toLowerCase());
}

function shouldSwapStrike(totalRuns: number, extraType?: string) {
  if (totalRuns % 2 === 0) return false;
  if (!extraType) return true;
  const normalized = extraType.toUpperCase();
  if ((normalized === "WD" || normalized === "NB") && totalRuns === 1) return false;
  return true;
}

function buildBallLabel(totalRuns: number, extraType?: string, isWicket?: boolean) {
  if (isWicket) return "W";
  if (!extraType) return String(totalRuns);
  const suffix = extraType.toLowerCase();
  if (totalRuns <= 1) return suffix;
  return `${totalRuns}${suffix}`;
}

function buildCommentaryEntry(event: ScoreEvent, summary: BallSummary): CommentaryEntry {
  const timestamp = new Date().toISOString();
  if (summary.isWicket) {
    return { seq: event.seq, text: `${summary.label} at ${event.over}.${event.ballInOver}`, type: "WICKET", timestamp };
  }
  if (summary.extraType) {
    return { seq: event.seq, text: `${summary.label} extras`, type: "EXTRA", timestamp };
  }
  return { seq: event.seq, text: `${summary.label} runs`, type: "RUN", timestamp };
}

const COMPUTED_RESULT_REASONS = new Set(["manual", "target_chased", "all_out", "overs_complete"]);

function normalizeReason(reason?: string | null) {
  const normalized = String(reason || "").trim().toLowerCase();
  return normalized || "";
}

function shouldComputeMatchResult(reason?: string | null) {
  const normalized = normalizeReason(reason);
  if (!normalized) return true;
  return COMPUTED_RESULT_REASONS.has(normalized);
}

function humanizeReason(reason: string) {
  const normalized = reason.replace(/_/g, " ").trim();
  if (!normalized) return "";
  return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
}

type MatchOutcome = {
  winnerId: string | null;
  winType: "runs" | "wickets" | "tie";
  winMargin: number | null;
  matchResult: string;
};

function resolveMatchOutcome(snapshot: MatchSnapshot, config: MatchConfig): MatchOutcome | null {
  const hasPrevious = Boolean(snapshot.previousInnings);
  if (!hasPrevious && (snapshot.target === null || snapshot.target === undefined)) {
    return null;
  }
  const team1Score = Number(snapshot.previousInnings?.runs ?? 0);
  const team2Score = Number(snapshot.runs ?? 0);
  const target =
    snapshot.target && snapshot.target > 0 ? snapshot.target : hasPrevious ? team1Score + 1 : null;
  const playersPerSide = getPlayersPerSide(config, snapshot.battingTeamId);
  const wicketsLimit = Math.max(playersPerSide - 1, 0);

  if (target !== null) {
    if (team2Score >= target) {
      const remainingWickets = Math.max(0, wicketsLimit - snapshot.wickets);
      return {
        winnerId: snapshot.battingTeamId || null,
        winType: "wickets",
        winMargin: remainingWickets,
        matchResult: `Won by ${remainingWickets} wickets`,
      };
    }
    if (team2Score === target - 1) {
      return {
        winnerId: null,
        winType: "tie",
        winMargin: null,
        matchResult: "Match Tied",
      };
    }
    const marginRuns = Math.max(0, (target - 1) - team2Score);
    return {
      winnerId: snapshot.bowlingTeamId || null,
      winType: "runs",
      winMargin: marginRuns,
      matchResult: `Won by ${marginRuns} runs`,
    };
  }

  if (hasPrevious) {
    if (team2Score > team1Score) {
      const remainingWickets = Math.max(0, wicketsLimit - snapshot.wickets);
      return {
        winnerId: snapshot.battingTeamId || null,
        winType: "wickets",
        winMargin: remainingWickets,
        matchResult: `Won by ${remainingWickets} wickets`,
      };
    }
    if (team2Score === team1Score) {
      return {
        winnerId: null,
        winType: "tie",
        winMargin: null,
        matchResult: "Match Tied",
      };
    }
    const marginRuns = Math.max(0, team1Score - team2Score);
    return {
      winnerId: snapshot.bowlingTeamId || null,
      winType: "runs",
      winMargin: marginRuns,
      matchResult: `Won by ${marginRuns} runs`,
    };
  }

  return null;
}

export function applyEvent(params: {
  snapshot: MatchSnapshot;
  event: ScoreEvent;
  config: MatchConfig;
  scorer?: { id: string; name: string } | null;
  playerNames?: Record<string, string>; // Injected names
}): MatchSnapshot {
  const { snapshot, event, config, scorer, playerNames = {} } = params;
  const updated = cloneSnapshot(snapshot);
  updated.version = event.seq;
  if (scorer) updated.scorer = scorer;

  // Helper to get name
  const getName = (id: string | null | undefined) => (id ? playerNames[id] || "Unknown" : "Unknown");

  switch (event.type as ScoreEventType) {
    case "INNINGS_START": {
      const payload = event.payload || {};
      return {
        ...buildInitialSnapshot({
          matchId: event.matchId,
          inningsNo: event.inningsNo,
          strikerId: payload.strikerId || "",
          nonStrikerId: payload.nonStrikerId || "",
          bowlerId: payload.bowlerId || "",
          battingTeamId: payload.battingTeamId || "",
          bowlingTeamId: payload.bowlingTeamId || "",
          oversConfig: config.overs,
          settings: config.settings,
          previousInnings: snapshot.inningsSummary || snapshot.previousInnings || null,
          target: snapshot.target ?? null,
        }),
        version: event.seq,
        scorer: scorer ?? snapshot.scorer ?? null,
        currentPartnership: {
          runs: 0,
          balls: 0,
          strikerId: payload.strikerId || "",
          nonStrikerId: payload.nonStrikerId || ""
        }
      };
    }
    case "BOWLER_SELECTED": {
      updated.bowlerId = event.payload?.bowlerId || updated.bowlerId || null;
      updated.pendingAction = "NONE";
      updated.pendingBowlerAfterBatsman = false;
      return updated;
    }
    case "BATSMAN_SELECTED": {
      const batsmanId = event.payload?.batsmanId || "";
      const slot = event.payload?.slot || updated.pendingBatsmanSlot || "striker";
      if (slot === "striker") {
        updated.strikerId = batsmanId;
      } else {
        updated.nonStrikerId = batsmanId;
      }
      updated.pendingBatsmanSlot = null;
      if (updated.pendingBowlerAfterBatsman) {
        updated.pendingBowlerAfterBatsman = false;
        updated.pendingAction = "SELECT_BOWLER";
      } else {
        updated.pendingAction = "NONE";
      }
      // Start new partnership
      updated.currentPartnership = {
        runs: 0,
        balls: 0,
        strikerId: updated.strikerId || "",
        nonStrikerId: updated.nonStrikerId || ""
      };
      return updated;
    }
    case "INNINGS_END": {
      updated.inningsSummary = {
        runs: updated.runs,
        wickets: updated.wickets,
        overs: updated.overs,
        runRate: updated.runRate,
      };
      if (updated.inningsNo === 1) {
        updated.status = "INNINGS_BREAK";
        updated.pendingAction = "START_INNINGS_2_APPROVAL";
        if (!updated.target) {
          updated.target = updated.runs + 1;
        }
        updated.requiredRR = null;
      } else {
        updated.status = "COMPLETED";
        updated.pendingAction = "NONE";
        const outcome = resolveMatchOutcome(updated, config);
        if (outcome) {
          updated.winnerId = outcome.winnerId;
          updated.winType = outcome.winType;
          updated.winMargin = outcome.winMargin;
          updated.matchResult = outcome.matchResult;
        }
      }
      return updated;
    }
    case "MATCH_END": {
      updated.status = "COMPLETED";
      updated.pendingAction = "NONE";
      const reason = event.payload?.reason || null;
      if (!shouldComputeMatchResult(reason)) {
        const normalized = normalizeReason(reason);
        updated.matchResult = humanizeReason(normalized) || updated.matchResult || null;
        updated.winnerId = null;
        updated.winType = null;
        updated.winMargin = null;
        return updated;
      }

      const outcome = resolveMatchOutcome(updated, config);
      if (outcome) {
        updated.winnerId = outcome.winnerId;
        updated.winType = outcome.winType;
        updated.winMargin = outcome.winMargin;
        updated.matchResult = outcome.matchResult;
      }
      return updated;
    }
    case "MATCH_LOCKED": {
      updated.locked = true;
      return updated;
    }
    case "MATCH_UNLOCKED": {
      updated.locked = false;
      return updated;
    }
    case "OVER_END": {
      const bowlerId = updated.bowlerId || "";
      if (bowlerId) {
        const bowlerLine = getBowlingLine(updated, bowlerId);
        if (updated.overRuns === 0) {
          bowlerLine.maidens += 1;
        }
      }
      updated.lastOverBowlerId = bowlerId || updated.lastOverBowlerId || null;
      updated.legalBallsInOver = 0;
      updated.runsPerOver = [...(updated.runsPerOver || []), updated.overRuns || 0];
      updated.overRuns = 0;
      updated.currentOverBalls = [];
      if (updated.pendingAction === "SELECT_BATSMAN") {
        updated.pendingBowlerAfterBatsman = true;
      } else {
        updated.pendingAction = "SELECT_BOWLER";
      }
      updated.bowlerId = null;
      return updated;
    }
    case "BALL_ADDED":
    case "EXTRA":
    case "WICKET": {
      const payload = event.payload || {};
      const strikerId = payload.strikerId || updated.strikerId || "";
      const nonStrikerId = payload.nonStrikerId || updated.nonStrikerId || "";
      const bowlerId = payload.bowlerId || updated.bowlerId || "";
      if (!strikerId || !nonStrikerId || !bowlerId) {
        throw new Error("Missing striker, non-striker, or bowler.");
      }

      // Pre-update stats for commentary
      const preStrikerLine = getBattingLine(updated, strikerId);
      const preBowlerLine = getBowlingLine(updated, bowlerId);
      const preTeamRuns = updated.runs;
      const preStrikerRuns = preStrikerLine.runs;
      const preBowlerWickets = preBowlerLine.wickets;

      const runsOffBat = Number(payload.runs || 0);
      const extraRuns = Number(payload.extras?.runs || 0);
      const extraType = payload.extras?.type;
      const totalRuns = runsOffBat + extraRuns;
      const legalDelivery = isLegalDelivery(payload, config);

      const nextBalls = updated.balls + (legalDelivery ? 1 : 0);
      const isWicket = event.type === "WICKET" || Boolean(payload.dismissal);
      const nextWickets = updated.wickets + (isWicket ? 1 : 0);
      updated.balls = nextBalls;
      updated.runs += totalRuns;
      updated.wickets = nextWickets;
      updated.overs = formatOvers(nextBalls);
      updated.runRate = formatRunRate(updated.runs, nextBalls);
      updated.legalBallsInOver = legalDelivery
        ? (updated.legalBallsInOver || 0) + 1
        : updated.legalBallsInOver || 0;
      updated.overRuns = (updated.overRuns || 0) + totalRuns;

      const strikerLine = getBattingLine(updated, strikerId);
      if (legalDelivery) strikerLine.balls += 1;
      if (runsOffBat) {
        strikerLine.runs += runsOffBat;
        if (runsOffBat === 4) strikerLine.fours += 1;
        if (runsOffBat === 6) strikerLine.sixes += 1;
      }

      const bowlerLine = getBowlingLine(updated, bowlerId);
      const nonBowlerRuns = extraType && NON_BOWLER_EXTRAS.has(extraType) ? extraRuns : 0;
      const bowlerRuns = totalRuns - nonBowlerRuns;
      bowlerLine.runs += bowlerRuns;
      if (legalDelivery) bowlerLine.balls += 1;
      if (isWicket && shouldCreditBowler(payload.dismissal)) {
        bowlerLine.wickets += 1;
      }

      const summary: BallSummary = {
        seq: event.seq,
        over: event.over,
        ballInOver: event.ballInOver,
        label: buildBallLabel(totalRuns, extraType, isWicket),
        isLegal: legalDelivery,
        isWicket,
        totalRuns,
        extraType,
        shotX: payload.shotX,
        shotY: payload.shotY,
        shotType: payload.shotType,
      };

      updated.currentOverBalls = [...updated.currentOverBalls, summary];
      updated.last12Balls = [...updated.last12Balls, summary].slice(-12);

      // Enhanced Commentary
      const entries = generateAutoCommentary({
        ball: summary,
        batterName: getName(strikerId),
        bowlerName: getName(bowlerId),
        dismissalType: payload.dismissal?.type,
        previousBatterRuns: preStrikerRuns,
        currentBatterRuns: strikerLine.runs,
        previousBowlerWickets: preBowlerWickets,
        currentBowlerWickets: bowlerLine.wickets,
        previousTeamRuns: preTeamRuns,
        currentTeamRuns: updated.runs,
        teamName: updated.battingTeamId === updated.battingTeamId ? "Batting Team" : "Team",
        batterId: strikerId,
        bowlerId: bowlerId,
        pressureLevel: "moderate", // simplified
      });
      // Flatten entries and ensure seq is present
      const processedEntries = entries.map(e => ({ ...e, seq: e.seq ?? event.seq }));
      updated.commentaryTail = [...updated.commentaryTail, ...processedEntries].slice(-12);

      const preStriker = strikerId;
      const preNonStriker = nonStrikerId;
      let nextStriker = preStriker;
      let nextNonStriker = preNonStriker;

      const swapForRuns = shouldSwapStrike(totalRuns, extraType);
      const swapForWicket =
        payload.dismissal?.crossed !== undefined
          ? Boolean(payload.dismissal.crossed)
          : swapForRuns;
      if ((isWicket ? swapForWicket : swapForRuns) && nextStriker && nextNonStriker) {
        const temp = nextStriker;
        nextStriker = nextNonStriker;
        nextNonStriker = temp;
      }

      const overEnded = legalDelivery && nextBalls % 6 === 0;
      if (overEnded && nextStriker && nextNonStriker) {
        const temp = nextStriker;
        nextStriker = nextNonStriker;
        nextNonStriker = temp;
      }

      // Termination Checks
      // Termination Checks
      const { isAllOut, isChased } = checkTermination(updated, config);

      if (isWicket) {
        const outId = payload.dismissal?.playerOutId || preStriker;
        const outIdMatches = outId === preStriker || outId === preNonStriker;

        const outLine = getBattingLine(updated, outId);
        outLine.isOut = true;

        if (isAllOut || isChased) {
          // Game/Innings Over triggers
          updated.pendingAction = "NONE";
          // We don't auto-transition to INNINGS_END event, the user must click it, but we stop asking for batter
          // Actually, if we set NONE, the UI shows "End Innings" button usually?
          // Or we specifically set a status?
          // Let's just NOT set SELECT_BATSMAN
        } else {
          // Normal wicket
          if (outId === preStriker || outId === preNonStriker) {
            const outIsStriker = nextStriker === outId;
            if (outIsStriker) {
              nextStriker = "";
              updated.pendingBatsmanSlot = "striker";
            } else {
              nextNonStriker = "";
              updated.pendingBatsmanSlot = "nonStriker";
            }
          }
          updated.pendingAction = "SELECT_BATSMAN";
          // Update partnership holders
          updated.currentPartnership = { runs: 0, balls: 0, strikerId: nextStriker, nonStrikerId: nextNonStriker };
        }
      } else {
        // Update partnership
        const partnershipRuns = totalRuns;
        // Partnership balls: we count if it was a legal delivery (usually, or any ball faced)
        // Standard is legal balls + wides? No, usually balls faced (legal + no balls). Wides don't count to balls faced for batter but do for partnership?
        // Let's stick to balls += 1 if valid ball.
        const partnershipBalls = legalDelivery ? 1 : 0;

        updated.currentPartnership = {
          runs: (updated.currentPartnership?.runs || 0) + partnershipRuns,
          balls: (updated.currentPartnership?.balls || 0) + partnershipBalls,
          strikerId: nextStriker,
          nonStrikerId: nextNonStriker
        };
      }

      // Check win condition for non-wicket balls too
      if (updated.target != null && updated.target > 0 && updated.runs >= updated.target) {
        // Win achieved!
        updated.pendingAction = "NONE";
        // Maybe set matchResult?
        // updated.status = "COMPLETED"; // No, let user confirm
      }

      // Over end logic overrides pending action if not wicket/win?
      // But if we need to select batter, that takes precedence.

      updated.strikerId = nextStriker || null;
      updated.nonStrikerId = nextNonStriker || null;
      updated.bowlerId = bowlerId;

      if (!isWicket) {
        updated.pendingAction = "NONE";
      }

      if (updated.target && updated.inningsNo === 2) {
        const remainingBalls = Math.max(updated.oversConfig * 6 - updated.balls, 0);
        const remainingRuns = Math.max(updated.target - updated.runs, 0);
        if (remainingRuns > 0 && remainingBalls > 0) {
          updated.requiredRR = (remainingRuns / (remainingBalls / 6)).toFixed(2);
        } else {
          updated.requiredRR = null;
        }
      }

      return updated;
    }
    default:
      return updated;
  }
}

export function validateNextAction(snapshot: MatchSnapshot, type: ScoreEventType) {
  const errors: string[] = [];
  const liveOnly = new Set([
    "BALL_ADDED",
    "EXTRA",
    "WICKET",
    "BOWLER_SELECTED",
    "BATSMAN_SELECTED",
  ]);
  if (snapshot.locked) {
    errors.push("Match is locked.");
  }
  if (snapshot.status === "COMPLETED") {
    if (!new Set(["MATCH_UNLOCKED", "MATCH_LOCKED"]).has(type)) {
      errors.push("Match is completed.");
    }
  }
  if (liveOnly.has(type) && snapshot.status !== "LIVE") {
    errors.push("Innings is not live.");
  }

  if (snapshot.pendingAction === "SELECT_BOWLER" && type !== "BOWLER_SELECTED") {
    errors.push("Select the next bowler before scoring.");
  }
  if (snapshot.pendingAction === "SELECT_BATSMAN" && type !== "BATSMAN_SELECTED") {
    errors.push("Select the next batsman before scoring.");
  }
  if (
    snapshot.pendingAction === "START_INNINGS_2_APPROVAL" &&
    type !== "INNINGS_START"
  ) {
    errors.push("Waiting for innings 2 to start.");
  }

  return { ok: errors.length === 0, errors };
}

export function resolveMatchStatus(snapshot: MatchSnapshot): MatchStatus {
  return snapshot.status;
}

export function getPlayersPerSide(config: MatchConfig, battingTeamId: string | null | undefined): number {
  const settingsPlayers = config.settings?.playersPerSide;
  if (typeof settingsPlayers === "number" && settingsPlayers > 0) {
    return settingsPlayers;
  }

  const teamAPlayers = typeof config.playersPerSideA === "number" && config.playersPerSideA > 0
    ? config.playersPerSideA
    : null;
  const teamBPlayers = typeof config.playersPerSideB === "number" && config.playersPerSideB > 0
    ? config.playersPerSideB
    : null;

  if (battingTeamId && config.teamAId && battingTeamId === config.teamAId && teamAPlayers) {
    return teamAPlayers;
  }
  if (battingTeamId && config.teamBId && battingTeamId === config.teamBId && teamBPlayers) {
    return teamBPlayers;
  }

  const fallback = teamAPlayers || teamBPlayers || 11;
  return fallback < 2 ? 11 : fallback;
}

export function checkTermination(snapshot: MatchSnapshot, config: MatchConfig) {
  const playersPerSide = getPlayersPerSide(config, snapshot.battingTeamId);
  const wicketsLimit = Math.max(playersPerSide - 1, 1);
  const isAllOut = snapshot.wickets >= wicketsLimit;
  const isChased =
    snapshot.target !== null &&
    snapshot.target !== undefined &&
    snapshot.target > 0 &&
    snapshot.runs >= snapshot.target;
  const isOversComplete = config.overs ? (snapshot.balls >= config.overs * 6) : false;

  return { isAllOut, isChased, isOversComplete };
}
