import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongo";
import { getAdminSession } from "@/lib/admin-session";
import { emitSnapshotUpdate } from "@/lib/socket";
import {
  ensureScoringIndexes,
  getEventDocByIdempotency,
  getEventDocBySeq,
  getEventsForInnings,
  getSnapshotDoc,
  insertScoreEvent,
  mapEventDoc,
  nextMatchSeq,
  persistSnapshot,
  serializeEventDoc,
  serializeSnapshotDoc,
  type ScoreEventDoc,
} from "@/lib/scoring/v2/store";
import { editSchema } from "@/lib/scoring/v2/schemas";
import { rebuildSnapshot } from "@/lib/scoring/v2/rebuild";
import { getMatchConfig, getMatchDoc } from "@/lib/scoring/v2/match";
import { buildAllowedActions, hasRolePermission, resolveMatchRole } from "@/lib/scoring/v2/roles";
import { writeAuditLog } from "@/lib/scoring/v2/audit";

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
  const body = await request.json().catch(() => ({}));
  const parsed = editSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", details: parsed.error.flatten() }, { status: 400 });
  }

  const { inningsNo, targetSeq, idempotencyKey, payload } = parsed.data;
  if (!matchId) {
    return NextResponse.json({ error: "matchId is required." }, { status: 400 });
  }

  const db = await getDb();
  await ensureScoringIndexes(db);

  const match = await getMatchDoc(db, matchId);
  if (!match) {
    return NextResponse.json({ error: "Match not found." }, { status: 404 });
  }

  const { role } = await resolveMatchRole(db, matchId, session.sub);
  if (!hasRolePermission(role, "manage")) {
    await writeAuditLog({
      db,
      matchId,
      userId: session.sub,
      action: "ROLE_DENIED",
      details: { action: "edit" },
    });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const existing = await getEventDocByIdempotency(db, matchId, idempotencyKey);
  if (existing) {
    const snapshotDoc = await getSnapshotDoc(db, matchId, existing.innings_no);
    return NextResponse.json({
      event: serializeEventDoc(existing),
      snapshot: snapshotDoc ? serializeSnapshotDoc(snapshotDoc) : null,
    });
  }

  const targetEvent = await getEventDocBySeq(db, matchId, targetSeq);
  if (!targetEvent) {
    return NextResponse.json({ error: "Target event not found." }, { status: 404 });
  }

  if (targetEvent.innings_no !== inningsNo) {
    return NextResponse.json({ error: "Target event belongs to another innings." }, { status: 400 });
  }

  if (["UNDO", "EDIT", "INNINGS_START", "MATCH_END"].includes(targetEvent.type)) {
    return NextResponse.json({ error: "Cannot edit this event type." }, { status: 400 });
  }

  const snapshotDoc = await getSnapshotDoc(db, matchId, inningsNo);
  if (!snapshotDoc) {
    return NextResponse.json({ error: "Snapshot not found." }, { status: 404 });
  }
  if (snapshotDoc.snapshot.locked) {
    return NextResponse.json({ error: "Match is locked." }, { status: 403 });
  }

  const seq = await nextMatchSeq(db, matchId);
  const eventDoc: ScoreEventDoc = {
    match_id: matchId,
    innings_no: inningsNo,
    seq,
    over: targetEvent.over,
    ball_in_over: targetEvent.ball_in_over,
    type: "EDIT",
    payload,
    created_by: session.sub,
    created_at: new Date(),
    idempotency_key: idempotencyKey,
    target_seq: targetSeq,
  };

  await insertScoreEvent(db, eventDoc);

  const updatedEventDocs = await getEventsForInnings(db, matchId, inningsNo);
  const updatedEvents = updatedEventDocs.map(mapEventDoc);
  const config = getMatchConfig(match);
  const rebuilt = rebuildSnapshot({
    matchId,
    inningsNo,
    events: updatedEvents,
    config,
    previousInnings: snapshotDoc.snapshot.previousInnings || null,
    target: snapshotDoc.snapshot.target || null,
  });
  rebuilt.version = eventDoc.seq;

  await persistSnapshot(db, {
    match_id: matchId,
    innings_no: inningsNo,
    snapshot: rebuilt,
    last_event_seq: eventDoc.seq,
  });

  await writeAuditLog({
    db,
    matchId,
    userId: session.sub,
    action: "EDIT",
    details: { targetSeq, seq },
  });

  const serialized = serializeSnapshotDoc({
    match_id: matchId,
    innings_no: inningsNo,
    snapshot: rebuilt,
    last_event_seq: eventDoc.seq,
    created_at: snapshotDoc.created_at,
    updated_at: new Date(),
  });

  emitSnapshotUpdate(matchId, { matchId, version: rebuilt.version, snapshot: serialized });

  return NextResponse.json({
    event: serializeEventDoc(eventDoc),
    snapshot: serialized,
    allowedActions: buildAllowedActions(rebuilt, role),
  });
}
