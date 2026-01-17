import type { Db } from "mongodb";
import type { MatchSnapshot, ScoreEvent, ScoreEventPayload, ScoreEventType } from "@/lib/scoring/v2/types";

export type ScoreEventDoc = {
  match_id: string;
  innings_no: number;
  seq: number;
  over: number;
  ball_in_over: number;
  type: ScoreEventType;
  payload: ScoreEventPayload;
  created_by: string;
  created_at: Date;
  idempotency_key: string;
  target_seq?: number;
};

export type MatchSnapshotDoc = {
  match_id: string;
  innings_no: number;
  snapshot: MatchSnapshot;
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
    db.collection("match_events").createIndex({ match_id: 1, innings_no: 1, seq: 1 }),
    db
      .collection("match_snapshots")
      .createIndex({ match_id: 1, innings_no: 1 }, { unique: true }),
    db.collection("match_counters").createIndex({ match_id: 1 }, { unique: true }),
    db.collection("match_roles").createIndex({ match_id: 1, user_id: 1 }, { unique: true }),
    db.collection("audit_logs").createIndex({ match_id: 1, created_at: -1 }),
    db.collection("match_client_sequences").createIndex({ match_id: 1, client_id: 1 }, { unique: true }),
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
    .collection<ScoreEventDoc>("match_events")
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

export async function insertScoreEvent(db: Db, doc: ScoreEventDoc, maxRetries = 3) {
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
        .collection<ScoreEventDoc>("match_events")
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

export async function getLatestSnapshotDoc(db: Db, matchId: string) {
  return (await db
    .collection<MatchSnapshotDoc>("match_snapshots")
    .findOne({ match_id: matchId }, { sort: { innings_no: -1 } })) as
    | MatchSnapshotDoc
    | null;
}

export async function getEventsForInnings(
  db: Db,
  matchId: string,
  inningsNo: number,
  sinceSeq?: number
) {
  const query: Record<string, any> = { match_id: matchId, innings_no: inningsNo };
  if (sinceSeq) query.seq = { $gt: sinceSeq };
  return await db.collection<ScoreEventDoc>("match_events").find(query).sort({ seq: 1 }).toArray();
}

export async function getEventDocByIdempotency(db: Db, matchId: string, key: string) {
  return (await db
    .collection<ScoreEventDoc>("match_events")
    .findOne({ match_id: matchId, idempotency_key: key })) as ScoreEventDoc | null;
}

export async function getEventDocBySeq(db: Db, matchId: string, seq: number) {
  return (await db
    .collection<ScoreEventDoc>("match_events")
    .findOne({ match_id: matchId, seq })) as ScoreEventDoc | null;
}

export async function persistSnapshot(
  db: Db,
  doc: Omit<MatchSnapshotDoc, "created_at" | "updated_at">,
  updatedAt = new Date()
) {
  const filter = {
    match_id: doc.match_id,
    innings_no: doc.innings_no,
    $or: [{ last_event_seq: { $lte: doc.last_event_seq } }, { last_event_seq: { $exists: false } }],
  };
  const update = {
    $set: {
      snapshot: doc.snapshot,
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

export function mapEventDoc(doc: ScoreEventDoc): ScoreEvent {
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

export function serializeEventDoc(doc: ScoreEventDoc) {
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
