import type { Db } from "mongodb";
import type { MatchSnapshot, ScoringEvent, ScoringEventType, ScoringPayload } from "@/lib/scoring/engine";

export type MatchEventDoc = {
  match_id: string;
  innings_no: number;
  seq: number;
  over: number;
  ball_in_over: number;
  type: ScoringEventType;
  payload: ScoringPayload;
  created_by: string;
  created_at: Date;
  idempotency_key: string;
  target_seq?: number;
};

export type SnapshotInitial = {
  strikerId: string;
  nonStrikerId: string;
  bowlerId: string;
  oversLimit?: number | null;
};

export type MatchSnapshotDoc = {
  match_id: string;
  innings_no: number;
  snapshot: MatchSnapshot;
  initial: SnapshotInitial;
  last_event_seq: number;
  created_at: Date;
  updated_at: Date;
};

let indexesReady = false;

export async function ensureScoringIndexes(db: Db) {
  if (indexesReady) return;
  await Promise.all([
    db
      .collection("match_events")
      .createIndex({ match_id: 1, seq: 1 }, { unique: true }),
    db
      .collection("match_events")
      .createIndex({ match_id: 1, idempotency_key: 1 }, { unique: true }),
    db
      .collection("match_events")
      .createIndex({ match_id: 1, innings_no: 1, seq: 1 }),
    db
      .collection("match_snapshots")
      .createIndex({ match_id: 1, innings_no: 1 }, { unique: true }),
    db
      .collection("match_counters")
      .createIndex({ match_id: 1 }, { unique: true }),
  ]);
  indexesReady = true;
}

export async function nextMatchSeq(db: Db, matchId: string) {
  const now = new Date();
  const result = await db.collection("match_counters").findOneAndUpdate(
    { match_id: matchId },
    {
      $inc: { seq: 1 },
      $set: { updated_at: now },
      $setOnInsert: { match_id: matchId, created_at: now },
    },
    { upsert: true, returnDocument: "after" }
  );
  const seq = result.value?.seq;
  if (typeof seq === "number" && Number.isFinite(seq)) {
    return seq;
  }

  const latest = await db
    .collection<MatchEventDoc>("match_events")
    .find({ match_id: matchId })
    .sort({ seq: -1 })
    .limit(1)
    .toArray();
  const fallbackSeq = (Number(latest?.[0]?.seq) || 0) + 1;
  await db.collection("match_counters").updateOne(
    { match_id: matchId },
    {
      $set: { seq: fallbackSeq, updated_at: now },
      $setOnInsert: { match_id: matchId, created_at: now },
    },
    { upsert: true }
  );
  return fallbackSeq;
}

export async function insertMatchEvent(
  db: Db,
  doc: MatchEventDoc,
  maxRetries = 3
) {
  let attempt = 0;
  while (true) {
    try {
      await db.collection("match_events").insertOne(doc);
      return doc;
    } catch (error: any) {
      if (error?.code !== 11000 || attempt >= maxRetries) {
        throw error;
      }
      attempt += 1;
      const latest = await db
        .collection<MatchEventDoc>("match_events")
        .find({ match_id: doc.match_id })
        .sort({ seq: -1 })
        .limit(1)
        .toArray();
      const fallbackSeq = (Number(latest?.[0]?.seq) || 0) + 1;
      await db.collection("match_counters").updateOne(
        { match_id: doc.match_id },
        {
          $set: { seq: fallbackSeq, updated_at: new Date() },
          $setOnInsert: { match_id: doc.match_id, created_at: new Date() },
        },
        { upsert: true }
      );
      doc.seq = fallbackSeq;
    }
  }
}

export async function getSnapshotDoc(db: Db, matchId: string, inningsNo: number) {
  return (await db
    .collection<MatchSnapshotDoc>("match_snapshots")
    .findOne({ match_id: matchId, innings_no: inningsNo })) as MatchSnapshotDoc | null;
}

export async function persistSnapshot(
  db: Db,
  doc: Omit<MatchSnapshotDoc, "created_at" | "updated_at">,
  updatedAt = new Date()
) {
  const filter = {
    match_id: doc.match_id,
    innings_no: doc.innings_no,
    $or: [
      { last_event_seq: { $lte: doc.last_event_seq } },
      { last_event_seq: { $exists: false } },
    ],
  };
  const update = {
    $set: {
      snapshot: doc.snapshot,
      initial: doc.initial,
      last_event_seq: doc.last_event_seq,
      updated_at: updatedAt,
    },
    $setOnInsert: {
      match_id: doc.match_id,
      innings_no: doc.innings_no,
      created_at: updatedAt,
    },
  };
  await db.collection<MatchSnapshotDoc>("match_snapshots").updateOne(filter, update, {
    upsert: true,
  });
}

export async function getEventDocByIdempotency(
  db: Db,
  matchId: string,
  idempotencyKey: string
) {
  return (await db
    .collection<MatchEventDoc>("match_events")
    .findOne({ match_id: matchId, idempotency_key: idempotencyKey })) as
    | MatchEventDoc
    | null;
}

export async function getEventDocBySeq(db: Db, matchId: string, seq: number) {
  return (await db
    .collection<MatchEventDoc>("match_events")
    .findOne({ match_id: matchId, seq })) as MatchEventDoc | null;
}

export async function getEventsForInnings(
  db: Db,
  matchId: string,
  inningsNo: number
) {
  return await db
    .collection<MatchEventDoc>("match_events")
    .find({ match_id: matchId, innings_no: inningsNo })
    .sort({ seq: 1 })
    .toArray();
}

export function mapEventDoc(doc: MatchEventDoc): ScoringEvent {
  return {
    matchId: doc.match_id,
    inningsNo: doc.innings_no,
    seq: doc.seq,
    over: doc.over,
    ballInOver: doc.ball_in_over,
    type: doc.type,
    payload: doc.payload,
    createdBy: doc.created_by,
    createdAt: doc.created_at.toISOString(),
    idempotencyKey: doc.idempotency_key,
    targetSeq: doc.target_seq,
  };
}

export function serializeEventDoc(doc: MatchEventDoc) {
  return {
    matchId: doc.match_id,
    inningsNo: doc.innings_no,
    seq: doc.seq,
    over: doc.over,
    ballInOver: doc.ball_in_over,
    type: doc.type,
    payload: doc.payload,
    createdBy: doc.created_by,
    createdAt: doc.created_at.toISOString(),
    idempotencyKey: doc.idempotency_key,
    targetSeq: doc.target_seq ?? null,
  };
}

export function serializeSnapshotDoc(doc: MatchSnapshotDoc) {
  const snapshot = doc.snapshot;
  return {
    ...snapshot,
    matchId: doc.match_id,
    inningsNo: doc.innings_no,
    lastEventSeq: doc.last_event_seq,
    updatedAt: doc.updated_at.toISOString(),
  };
}
