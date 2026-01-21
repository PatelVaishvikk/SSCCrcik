export type MatchRole = "ADMIN" | "ORGANIZER" | "SCORER" | "VIEWER";

export type PendingAction =
  | "NONE"
  | "SELECT_BOWLER"
  | "SELECT_BATSMAN"
  | "START_INNINGS_2_APPROVAL"
  | "INNINGS_BREAK";

export type MatchStatus = "SCHEDULED" | "LIVE" | "INNINGS_BREAK" | "COMPLETED";

export type ExtraType = "WD" | "NB" | "LB" | "B" | "PEN";

export type ScoreEventType =
  | "INNINGS_START"
  | "BALL_ADDED"
  | "WICKET"
  | "EXTRA"
  | "OVER_END"
  | "BOWLER_SELECTED"
  | "BATSMAN_SELECTED"
  | "INNINGS_END"
  | "MATCH_END"
  | "UNDO"
  | "EDIT"
  | "MATCH_LOCKED"
  | "MATCH_UNLOCKED";

export type DismissalInfo = {
  type: string;
  playerOutId?: string;
  fielderId?: string;
  crossed?: boolean;
};

export type ScoreEventPayload = {
  runs?: number;
  extras?: { type: ExtraType; runs: number };
  dismissal?: DismissalInfo;
  strikerId?: string;
  nonStrikerId?: string;
  bowlerId?: string;
  batsmanId?: string;
  slot?: "striker" | "nonStriker";
  battingTeamId?: string;
  bowlingTeamId?: string;
  reason?: string;
  over?: number;
  ballInOver?: number;
  shotX?: number;
  shotY?: number;
  shotType?: string;
};

export type ScoreEvent = {
  matchId: string;
  inningsNo: number;
  seq: number;
  over: number;
  ballInOver: number;
  type: ScoreEventType;
  payload: ScoreEventPayload;
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
  maidens: number;
};

export type BallSummary = {
  seq: number;
  over: number;
  ballInOver: number;
  label: string;
  isLegal: boolean;
  isWicket: boolean;
  totalRuns: number;
  extraType?: ExtraType;
  shotX?: number;
  shotY?: number;
  shotType?: string;
};

// Enhanced Commentary Types compatible with commentary.ts
export type CommentaryEntry = {
  seq: number;
  type: "RUN" | "WICKET" | "wicket" | "EXTRA" | "INFO" | "ball" | "milestone" | "boundary" | "over_summary" | "match_situation" | "pressure" | "partnership";
  text: string;
  timestamp: string;
  priority?: "low" | "medium" | "high";
  highlight?: boolean;
};

export type InningsSummary = {
  runs: number;
  wickets: number;
  overs: string;
  runRate: string;
};

export type MatchSnapshot = {
  matchId: string;
  inningsNo: number;
  version: number;
  status: MatchStatus;
  locked?: boolean;
  oversConfig: number;
  settings?: MatchSettings;
  balls: number;
  overs: string;
  runs: number;
  wickets: number;
  runRate: string;
  target?: number | null;
  requiredRR?: string | null;
  strikerId?: string | null;
  nonStrikerId?: string | null;
  bowlerId?: string | null;
  battingTeamId?: string | null;
  bowlingTeamId?: string | null;
  batsmen: Record<string, BattingLine>;
  bowlers: Record<string, BowlingLine>;
  currentOverBalls: BallSummary[];
  last12Balls: BallSummary[];
  commentaryTail: CommentaryEntry[];
  pendingAction: PendingAction;
  pendingBatsmanSlot?: "striker" | "nonStriker" | null;
  pendingBowlerAfterBatsman?: boolean | null;
  scorer?: { id: string; name: string } | null;
  inningsSummary?: InningsSummary | null;
  previousInnings?: InningsSummary | null;
  lastOverBowlerId?: string | null;
  legalBallsInOver: number;
  overRuns: number;
  matchResult?: string | null;
  winnerId?: string | null;
  winMargin?: number | null;
  winType?: "runs" | "wickets" | "tie" | "draw" | null;
  allowedActions?: {
    canScore: boolean;
    canUndo: boolean;
    canSelectBowler: boolean;
    canSelectBatsman: boolean;
    canStartInnings2: boolean;
    canEndInnings: boolean;
    canEndMatch: boolean;
    canLockMatch: boolean;
  };
  currentPartnership?: {
    runs: number;
    balls: number;
    strikerId: string;
    nonStrikerId: string;
  };
  runsPerOver?: number[];
};

export type MatchSettings = {
  noConsecutiveBowler?: boolean;
  countWideAsBall?: boolean;
  countNoBallAsBall?: boolean;
  playersPerSide?: number;
};

export type MatchConfig = {
  overs: number;
  settings: MatchSettings;
  teamAId?: string;
  teamBId?: string;
  playersPerSideA?: number;
  playersPerSideB?: number;
};

export type NextActionValidation = {
  ok: boolean;
  errors: string[];
};
