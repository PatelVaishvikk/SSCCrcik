import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongo";
import { getAdminSession } from "@/lib/admin-session";
import { emitSnapshotUpdate } from "@/lib/socket";
import { applyEvent } from "@/lib/scoring/v2/engine";
import {
  ensureScoringIndexes,
  getEventDocByIdempotency,
  getLatestSnapshotDoc,
  insertScoreEvent,
  nextMatchSeq,
  persistSnapshot,
  serializeEventDoc,
  serializeSnapshotDoc,
  type ScoreEventDoc,
} from "@/lib/scoring/v2/store";
import { lockSchema } from "@/lib/scoring/v2/schemas";
import { getMatchConfig, getMatchDoc } from "@/lib/scoring/v2/match";
import { buildAllowedActions, resolveMatchRole } from "@/lib/scoring/v2/roles";
import { writeAuditLog } from "@/lib/scoring/v2/audit";
import type { ScoreEvent } from "@/lib/scoring/v2/types";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const matchId = String(id || "").trim();
  if (!matchId) {
    return NextResponse.json({ error: "matchId is required." }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = lockSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", details: parsed.error.flatten() }, { status: 400 });
  }

  const { idempotencyKey, unlock } = parsed.data;

  const db = await getDb();
  await ensureScoringIndexes(db);

  const match = await getMatchDoc(db, matchId);
  if (!match) {
    return NextResponse.json({ error: "Match not found." }, { status: 404 });
  }

  const { role, user } = await resolveMatchRole(db, matchId, session.sub);
  if (unlock && role !== "ADMIN") {
    return NextResponse.json({ error: "Only admin can unlock matches." }, { status: 403 });
  }
  if (!unlock && role !== "ADMIN" && role !== "ORGANIZER") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const snapshotDoc = await getLatestSnapshotDoc(db, matchId);
  if (!snapshotDoc) {
    return NextResponse.json({ error: "Match has no snapshot." }, { status: 409 });
  }

  const snapshot = snapshotDoc.snapshot;
  if (!unlock && snapshot.status !== "COMPLETED") {
    return NextResponse.json({ error: "Match is not completed yet." }, { status: 409 });
  }

  const existing = await getEventDocByIdempotency(db, matchId, idempotencyKey);
  if (existing) {
    return NextResponse.json({
      event: serializeEventDoc(existing),
      snapshot: serializeSnapshotDoc(snapshotDoc),
    });
  }

  const config = getMatchConfig(match);
  const seq = await nextMatchSeq(db, matchId);
  const type = unlock ? "MATCH_UNLOCKED" : "MATCH_LOCKED";
  const eventDoc: ScoreEventDoc = {
    match_id: matchId,
    innings_no: snapshot.inningsNo,
    seq,
    over: snapshot.balls ? Math.floor((snapshot.balls - 1) / 6) : 0,
    ball_in_over: snapshot.balls ? ((snapshot.balls - 1) % 6) + 1 : 0,
    type,
    payload: {},
    created_by: session.sub,
    created_at: new Date(),
    idempotency_key: idempotencyKey,
  };

  await insertScoreEvent(db, eventDoc);

  const event: ScoreEvent = {
    matchId,
    inningsNo: snapshot.inningsNo,
    seq,
    over: eventDoc.over,
    ballInOver: eventDoc.ball_in_over,
    type,
    payload: eventDoc.payload,
    createdBy: session.sub,
    createdAt: eventDoc.created_at.toISOString(),
    idempotencyKey,
  };

  const scorer = user ? { id: user.id, name: user.name } : null;
  const nextSnapshot = applyEvent({
    snapshot,
    event,
    config,
    scorer: scorer || undefined,
  });

  await persistSnapshot(db, {
    match_id: matchId,
    innings_no: snapshot.inningsNo,
    snapshot: nextSnapshot,
    last_event_seq: nextSnapshot.version,
  });

  await db.collection("managed_matches").updateOne(
    { match_id: matchId },
    {
      $set: {
        locked: !unlock,
        updated_at: new Date(),
      },
    }
  );

  await writeAuditLog({
    db,
    matchId,
    userId: session.sub,
    action: unlock ? "MATCH_UNLOCK" : "MATCH_LOCK",
    details: { seq },
  });

  const serialized = serializeSnapshotDoc({
    match_id: matchId,
    innings_no: snapshot.inningsNo,
    snapshot: nextSnapshot,
    last_event_seq: nextSnapshot.version,
    created_at: snapshotDoc.created_at,
    updated_at: new Date(),
  });

  emitSnapshotUpdate(matchId, { matchId, version: nextSnapshot.version, snapshot: serialized });

  return NextResponse.json({
    event: serializeEventDoc(eventDoc),
    snapshot: serialized,
    role,
    allowedActions: buildAllowedActions(nextSnapshot, role),
  });
}
