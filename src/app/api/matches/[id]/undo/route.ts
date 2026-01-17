import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongo";
import { getAdminSession } from "@/lib/admin-session";
import { emitSnapshotUpdate } from "@/lib/socket";
import {
  ensureScoringIndexes,
  getEventDocByIdempotency,
  getEventDocBySeq,
  getEventsForInnings,
  getLatestSnapshotDoc,
  getSnapshotDoc,
  insertScoreEvent,
  mapEventDoc,
  nextMatchSeq,
  persistSnapshot,
  serializeEventDoc,
  serializeSnapshotDoc,
  type ScoreEventDoc,
} from "@/lib/scoring/v2/store";
import { undoSchema } from "@/lib/scoring/v2/schemas";
import { rebuildSnapshot } from "@/lib/scoring/v2/rebuild";
import { getMatchConfig, getMatchDoc } from "@/lib/scoring/v2/match";
import { buildAllowedActions, hasRolePermission, resolveMatchRole } from "@/lib/scoring/v2/roles";
import { writeAuditLog } from "@/lib/scoring/v2/audit";
import { commitClientSequence, validateClientSequence, validateExpectedVersion } from "@/lib/scoring/v2/sync";

export const dynamic = "force-dynamic";

function isUndoableType(type: string) {
  return ["BALL_ADDED", "EXTRA", "WICKET", "OVER_END"].includes(type);
}

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
  const parsed = undoSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", details: parsed.error.flatten() }, { status: 400 });
  }

  const { inningsNo, targetSeq, idempotencyKey, clientId, clientSeq, expectedVersion } = parsed.data;
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
  if (!hasRolePermission(role, "score")) {
    await writeAuditLog({
      db,
      matchId,
      userId: session.sub,
      action: "ROLE_DENIED",
      details: { action: "undo" },
    });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const snapshotDoc = inningsNo
    ? await getSnapshotDoc(db, matchId, inningsNo)
    : await getLatestSnapshotDoc(db, matchId);
  if (!snapshotDoc) {
    return NextResponse.json({ error: "Snapshot not found." }, { status: 404 });
  }
  if (snapshotDoc.snapshot.locked) {
    return NextResponse.json({ error: "Match is locked." }, { status: 403 });
  }

  const activeInnings = snapshotDoc.innings_no;
  const existing = await getEventDocByIdempotency(db, matchId, idempotencyKey);
  if (existing) {
    const snapshotDocExisting = await getSnapshotDoc(db, matchId, existing.innings_no);
    await commitClientSequence({ db, matchId, clientId, clientSeq });
    return NextResponse.json({
      event: serializeEventDoc(existing),
      snapshot: snapshotDocExisting ? serializeSnapshotDoc(snapshotDocExisting) : null,
    });
  }

  const versionError = validateExpectedVersion(snapshotDoc.snapshot, expectedVersion);
  if (versionError) {
    return NextResponse.json({ error: versionError.error, details: versionError }, { status: 409 });
  }

  const seqError = await validateClientSequence({ db, matchId, clientId, clientSeq });
  if (seqError) {
    return NextResponse.json({ error: seqError.error, details: seqError }, { status: 409 });
  }

  const eventDocs = await getEventsForInnings(db, matchId, activeInnings);
  const events = eventDocs.map(mapEventDoc);

  let targets: number[] = [];
  if (targetSeq) {
    const targetEvent = await getEventDocBySeq(db, matchId, targetSeq);
    if (!targetEvent) {
      return NextResponse.json({ error: "Target event not found." }, { status: 404 });
    }
    if (targetEvent.innings_no !== activeInnings) {
      return NextResponse.json({ error: "Target event belongs to another innings." }, { status: 400 });
    }
    if (!isUndoableType(targetEvent.type)) {
      return NextResponse.json({ error: "Cannot undo this event type." }, { status: 400 });
    }
    targets = [targetEvent.seq];
  } else {
    const voided = new Set<number>();
    events.forEach((event) => {
      if (event.type === "UNDO" && event.targetSeq) {
        voided.add(event.targetSeq);
      }
    });

    const candidates = events.filter(
      (event) => !["UNDO", "EDIT", "INNINGS_START", "INNINGS_END", "MATCH_END"].includes(event.type)
    );
    const last = [...candidates].reverse().find((event) => !voided.has(event.seq));
    if (!last || !isUndoableType(last.type)) {
      return NextResponse.json({ error: "No undoable events found." }, { status: 409 });
    }
    targets = [last.seq];
    if (last.type === "OVER_END") {
      const previousBall = [...candidates]
        .reverse()
        .find((event) => event.seq < last.seq && isUndoableType(event.type));
      if (previousBall) {
        targets = [last.seq, previousBall.seq];
      }
    }
  }

  let lastUndoDoc: ScoreEventDoc | null = null;
  for (let i = 0; i < targets.length; i += 1) {
    const target = targets[i];
    const seq = await nextMatchSeq(db, matchId);
    const doc: ScoreEventDoc = {
      match_id: matchId,
      innings_no: activeInnings,
      seq,
      over: snapshotDoc.snapshot.balls ? Math.floor((snapshotDoc.snapshot.balls - 1) / 6) : 0,
      ball_in_over: snapshotDoc.snapshot.balls
        ? ((snapshotDoc.snapshot.balls - 1) % 6) + 1
        : 0,
      type: "UNDO",
      payload: {},
      created_by: session.sub,
      created_at: new Date(),
      idempotency_key: i === 0 ? idempotencyKey : `${idempotencyKey}_${i}`,
      target_seq: target,
    };
    await insertScoreEvent(db, doc);
    lastUndoDoc = doc;
  }

  const updatedEventDocs = await getEventsForInnings(db, matchId, activeInnings);
  const updatedEvents = updatedEventDocs.map(mapEventDoc);
  const config = getMatchConfig(match);
  const rebuilt = rebuildSnapshot({
    matchId,
    inningsNo: activeInnings,
    events: updatedEvents,
    config,
    previousInnings: snapshotDoc.snapshot.previousInnings || null,
    target: snapshotDoc.snapshot.target || null,
  });
  if (lastUndoDoc?.seq) {\n    rebuilt.version = lastUndoDoc.seq;\n  }

  await persistSnapshot(db, {
    match_id: matchId,
    innings_no: activeInnings,
    snapshot: rebuilt,
    last_event_seq: lastUndoDoc?.seq || snapshotDoc.last_event_seq,
  });

  await commitClientSequence({ db, matchId, clientId, clientSeq });

  await writeAuditLog({
    db,
    matchId,
    userId: session.sub,
    action: "UNDO",
    details: { targets },
  });

  const serialized = serializeSnapshotDoc({
    match_id: matchId,
    innings_no: activeInnings,
    snapshot: rebuilt,
    last_event_seq: lastUndoDoc?.seq || snapshotDoc.last_event_seq,
    created_at: snapshotDoc.created_at,
    updated_at: new Date(),
  });

  emitSnapshotUpdate(matchId, { matchId, version: rebuilt.version, snapshot: serialized });

  return NextResponse.json({
    event: lastUndoDoc ? serializeEventDoc(lastUndoDoc) : null,
    snapshot: serialized,
    allowedActions: buildAllowedActions(rebuilt, role),
  });
}
