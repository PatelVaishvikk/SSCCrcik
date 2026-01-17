import type { MatchSnapshot, ScoreEventPayload, ScoreEventType } from "@/lib/scoring/v2/types";

export type SocketJoinPayload = {
  matchId: string;
  lastVersion?: number | null;
};

export type SocketBallEvent = {
  inningsNo: number;
  seq: number;
  over: number;
  ballInOver: number;
  type: ScoreEventType;
  payload: ScoreEventPayload;
};

export type SocketSnapshot = MatchSnapshot & {
  lastEventSeq?: number;
  updatedAt?: string;
};

export type SocketSnapshotUpdatedPayload = {
  matchId: string;
  version: number;
  snapshot: SocketSnapshot;
};

export type SocketBallAddedPayload = {
  matchId: string;
  version: number;
  event: SocketBallEvent;
};

export type SocketSyncRequestPayload = SocketJoinPayload;
