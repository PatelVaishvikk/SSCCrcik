import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongo";
import { getAdminSession } from "@/lib/admin-session";
import { emitSnapshotUpdate } from "@/lib/socket";
import { applyEvent } from "@/lib/scoring/v2/engine";
import {
  ensureScoringIndexes,
  getEventDocByIdempotency,
  getSnapshotDoc,
  insertScoreEvent,
  nextMatchSeq,
  persistSnapshot,
  serializeEventDoc,
  serializeSnapshotDoc,
  type ScoreEventDoc,
} from "@/lib/scoring/v2/store";
import { inningsEndSchema } from "@/lib/scoring/v2/schemas";
import { getMatchConfig, getMatchDoc } from "@/lib/scoring/v2/match";
import { buildAllowedActions, hasRolePermission, resolveMatchRole } from "@/lib/scoring/v2/roles";
import { writeAuditLog } from "@/lib/scoring/v2/audit";
import { commitClientSequence, validateClientSequence, validateExpectedVersion } from "@/lib/scoring/v2/sync";
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
  const parsed = inningsEndSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", details: parsed.error.flatten() }, { status: 400 });
  }

  const { inningsNo, idempotencyKey, reason, clientId, clientSeq, expectedVersion } = parsed.data;

  const db = await getDb();
  await ensureScoringIndexes(db);

  const match = await getMatchDoc(db, matchId);
  if (!match) {
    return NextResponse.json({ error: "Match not found." }, { status: 404 });
  }

  const { role, user } = await resolveMatchRole(db, matchId, session.sub);
  if (!hasRolePermission(role, "manage")) {
    await writeAuditLog({
      db,
      matchId,
      userId: session.sub,
      action: "ROLE_DENIED",
      details: { action: "end_innings" },
    });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const existing = await getEventDocByIdempotency(db, matchId, idempotencyKey);
  if (existing) {
    const snapshotDocExisting = await getSnapshotDoc(db, matchId, existing.innings_no);
    await commitClientSequence({ db, matchId, clientId, clientSeq });
    return NextResponse.json({
      event: serializeEventDoc(existing),
      snapshot: snapshotDocExisting ? serializeSnapshotDoc(snapshotDocExisting) : null,
    });
  }

  const snapshotDoc = await getSnapshotDoc(db, matchId, inningsNo);
  if (!snapshotDoc) {
    return NextResponse.json({ error: "Innings has not started." }, { status: 409 });
  }

  const snapshot = snapshotDoc.snapshot;
  const versionError = validateExpectedVersion(snapshot, expectedVersion);
  if (versionError) {
    return NextResponse.json({ error: versionError.error, details: versionError }, { status: 409 });
  }

  const seqError = await validateClientSequence({ db, matchId, clientId, clientSeq });
  if (seqError) {
    return NextResponse.json({ error: seqError.error, details: seqError }, { status: 409 });
  }

  const config = getMatchConfig(match);
  const seq = await nextMatchSeq(db, matchId);
  const eventDoc: ScoreEventDoc = {
    match_id: matchId,
    innings_no: inningsNo,
    seq,
    over: snapshot.balls ? Math.floor((snapshot.balls - 1) / 6) : 0,
    ball_in_over: snapshot.balls ? ((snapshot.balls - 1) % 6) + 1 : 0,
    type: "INNINGS_END",
    payload: { reason: reason || "manual" },
    created_by: session.sub,
    created_at: new Date(),
    idempotency_key: idempotencyKey,
  };

  await insertScoreEvent(db, eventDoc);

  const event: ScoreEvent = {
    matchId,
    inningsNo,
    seq,
    over: eventDoc.over,
    ballInOver: eventDoc.ball_in_over,
    type: "INNINGS_END",
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
    innings_no: inningsNo,
    snapshot: nextSnapshot,
    last_event_seq: nextSnapshot.version,
  });

  await commitClientSequence({ db, matchId, clientId, clientSeq });

  await db.collection("managed_matches").updateOne(
    { match_id: matchId },
    {
      $set: {
        status: (nextSnapshot.status || "innings_break").toLowerCase(),
        current_innings: inningsNo,
        updated_at: new Date(),
      },
    }
  );

  await writeAuditLog({
    db,
    matchId,
    userId: session.sub,
    action: "INNINGS_END",
    details: { inningsNo, seq },
  });

  const serialized = serializeSnapshotDoc({
    match_id: matchId,
    innings_no: inningsNo,
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
