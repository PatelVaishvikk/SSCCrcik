export type ScoringEventType =
  | "BALL_ADDED"
  | "EXTRA"
  | "WICKET"
  | "UNDO"
  | "EDIT"
  | "INNINGS_END";

export type ExtraType = "WD" | "NB" | "LB" | "B" | "PEN";

export type DismissalInfo = {
  type: string;
  playerOutId?: string;
  fielderId?: string;
  crossed?: boolean;
};

export type ScoringPayload = {
  runs?: number;
  extras?: { type: ExtraType; runs: number };
  dismissal?: DismissalInfo;
  strikerId?: string;
  nonStrikerId?: string;
  bowlerId?: string;
  nextBatterId?: string;
};

export type ScoringEvent = {
  matchId: string;
  inningsNo: number;
  seq: number;
  over: number;
  ballInOver: number;
  type: ScoringEventType;
  payload: ScoringPayload;
  createdBy: string;
  createdAt: string;
  idempotencyKey: string;
  targetSeq?: number;
};

export type BattingLine = {
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
  isOut?: boolean;
};

export type BowlingLine = {
  runs: number;
  balls: number;
  wickets: number;
};

export type BallSummary = {
  over: number;
  ballInOver: number;
  totalRuns: number;
  isWicket: boolean;
  extraType?: ExtraType;
  label: string;
};

export type MatchSnapshot = {
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
  batsmen: Record<string, BattingLine>;
  bowlers: Record<string, BowlingLine>;
  lastBalls: BallSummary[];
  status: "live" | "completed";
  oversLimit?: number | null;
};

const ILLEGAL_EXTRAS = new Set<ExtraType>(["WD", "NB", "PEN"]);
const NON_BOWLER_EXTRAS = new Set<ExtraType>(["B", "LB", "PEN"]);
const NON_BOWLER_WICKETS = new Set<string>([
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

export function isLegalDelivery(payload: ScoringPayload) {
  const extraType = payload.extras?.type;
  if (!extraType) return true;
  return !ILLEGAL_EXTRAS.has(extraType);
}

export function buildInitialSnapshot(params: {
  matchId: string;
  inningsNo: number;
  strikerId: string;
  nonStrikerId: string;
  bowlerId: string;
  oversLimit?: number | null;
}): MatchSnapshot {
  return {
    matchId: params.matchId,
    inningsNo: params.inningsNo,
    runs: 0,
    wickets: 0,
    balls: 0,
    overs: "0.0",
    runRate: "0.00",
    strikerId: params.strikerId,
    nonStrikerId: params.nonStrikerId,
    bowlerId: params.bowlerId,
    batsmen: {},
    bowlers: {},
    lastBalls: [],
    status: "live",
    oversLimit: params.oversLimit ?? null,
  };
}

function getBattingLine(snapshot: MatchSnapshot, playerId: string) {
  if (!snapshot.batsmen[playerId]) {
    snapshot.batsmen[playerId] = { runs: 0, balls: 0, fours: 0, sixes: 0 };
  }
  return snapshot.batsmen[playerId];
}

function getBowlingLine(snapshot: MatchSnapshot, playerId: string) {
  if (!snapshot.bowlers[playerId]) {
    snapshot.bowlers[playerId] = { runs: 0, balls: 0, wickets: 0 };
  }
  return snapshot.bowlers[playerId];
}

function shouldCreditBowler(dismissal?: DismissalInfo) {
  if (!dismissal?.type) return false;
  return !NON_BOWLER_WICKETS.has(dismissal.type.toLowerCase());
}

export function applyScoringEvent(
  snapshot: MatchSnapshot,
  event: ScoringEvent
): MatchSnapshot {
  const payload = event.payload || {};
  const strikerId = snapshot.strikerId || payload.strikerId;
  const nonStrikerId = snapshot.nonStrikerId || payload.nonStrikerId;
  const bowlerId = payload.bowlerId || snapshot.bowlerId;

  if (!strikerId || !nonStrikerId || !bowlerId) {
    throw new Error("Missing striker, non-striker, or bowler.");
  }

  const runsOffBat = Number(payload.runs || 0);
  const extraRuns = Number(payload.extras?.runs || 0);
  const extraType = payload.extras?.type;
  const totalRuns = runsOffBat + extraRuns;
  const legalDelivery = isLegalDelivery(payload);

  if (snapshot.oversLimit && legalDelivery) {
    const maxBalls = snapshot.oversLimit * 6;
    if (snapshot.balls >= maxBalls) {
      throw new Error("Overs limit reached.");
    }
  }

  const nextBalls = snapshot.balls + (legalDelivery ? 1 : 0);
  const nextRuns = snapshot.runs + totalRuns;
  const isWicket = event.type === "WICKET" || Boolean(payload.dismissal);
  const nextWickets = snapshot.wickets + (isWicket ? 1 : 0);

  const updated: MatchSnapshot = {
    ...snapshot,
    runs: nextRuns,
    wickets: nextWickets,
    balls: nextBalls,
    overs: formatOvers(nextBalls),
    runRate: formatRunRate(nextRuns, nextBalls),
    strikerId,
    nonStrikerId,
    bowlerId,
    batsmen: { ...snapshot.batsmen },
    bowlers: { ...snapshot.bowlers },
    lastBalls: [...snapshot.lastBalls],
    status: snapshot.status,
  };

  const strikerLine = getBattingLine(updated, strikerId);
  if (legalDelivery) {
    strikerLine.balls += 1;
  }
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

  let nextStriker = strikerId;
  let nextNonStriker = nonStrikerId;

  if (isWicket) {
    const outId = payload.dismissal?.playerOutId || strikerId;
    const nextBatter = payload.nextBatterId || "";
    if (outId === strikerId) {
      nextStriker = nextBatter;
    } else if (outId === nonStrikerId) {
      nextNonStriker = nextBatter;
    }
    if (outId) {
      const line = getBattingLine(updated, outId);
      line.isOut = true;
    }
  }

  const swapOnRuns = totalRuns % 2 === 1;
  const swapOnWicket = Boolean(payload.dismissal?.crossed);
  const shouldSwap = isWicket ? swapOnWicket : swapOnRuns;
  if (shouldSwap && nextStriker && nextNonStriker) {
    const temp = nextStriker;
    nextStriker = nextNonStriker;
    nextNonStriker = temp;
  }
  if (legalDelivery && nextBalls % 6 === 0 && nextStriker && nextNonStriker) {
    const temp = nextStriker;
    nextStriker = nextNonStriker;
    nextNonStriker = temp;
  }

  updated.strikerId = nextStriker;
  updated.nonStrikerId = nextNonStriker;

  const ballLabel = `${event.over}.${event.ballInOver}`;
  const ballSummary: BallSummary = {
    over: event.over,
    ballInOver: event.ballInOver,
    totalRuns,
    isWicket,
    extraType,
    label: isWicket
      ? "W"
      : extraType
        ? `${totalRuns || ""}${extraType}`
        : String(totalRuns),
  };
  updated.lastBalls = [...updated.lastBalls, ballSummary].slice(-12);

  if (snapshot.oversLimit) {
    const maxBalls = snapshot.oversLimit * 6;
    if (nextBalls >= maxBalls) {
      updated.status = "completed";
    }
  }

  if (nextWickets >= 10) {
    updated.status = "completed";
  }

  return updated;
}

export function rebuildSnapshot({
  matchId,
  inningsNo,
  events,
  initial,
}: {
  matchId: string;
  inningsNo: number;
  events: ScoringEvent[];
  initial: MatchSnapshot;
}) {
  const overrides = new Map<number, ScoringEvent>();
  const voided = new Set<number>();

  events.forEach((event) => {
    if (event.type === "UNDO" && event.targetSeq) {
      voided.add(event.targetSeq);
    }
    if (event.type === "EDIT" && event.targetSeq) {
      overrides.set(event.targetSeq, event);
    }
  });

  let snapshot = { ...initial };
  for (const event of events) {
    if (event.type === "UNDO" || event.type === "EDIT") continue;
    if (event.type === "INNINGS_END") {
      snapshot.status = "completed";
      break;
    }
    if (voided.has(event.seq)) continue;
    const override = overrides.get(event.seq);
    const applied = override
      ? {
          ...event,
          type: override.payload?.dismissal
            ? "WICKET"
            : override.payload?.extras
              ? "EXTRA"
              : "BALL_ADDED",
          payload: override.payload,
        }
      : event;
    snapshot = applyScoringEvent(snapshot, applied);
  }

  return snapshot;
}
