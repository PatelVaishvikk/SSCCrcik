import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongo";
import { getAdminSession } from "@/lib/admin-session";
import { emitBallAdded, emitSnapshotUpdate } from "@/lib/socket";
import { updateTournamentStandings } from "@/lib/standings";
import { updateMatchStats } from "@/lib/stats-worker";
import {
  applyEvent,
  getNextBallLabel,
  isLegalDelivery,
  validateNextAction,
} from "@/lib/scoring/v2/engine";
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
import { ballEventSchema } from "@/lib/scoring/v2/schemas";
import { getMatchConfig, getMatchDoc } from "@/lib/scoring/v2/match";
import { buildAllowedActions, resolveMatchRole, hasRolePermission } from "@/lib/scoring/v2/roles";
import { writeAuditLog } from "@/lib/scoring/v2/audit";
import { buildResultSummary } from "@/lib/scoring/v2/result";
import { commitClientSequence, validateClientSequence, validateExpectedVersion } from "@/lib/scoring/v2/sync";
import type { ScoreEvent } from "@/lib/scoring/v2/types";

export const dynamic = "force-dynamic";

function validatePayloadRules(type: string, payload: any) {
  const errors: string[] = [];
  if (type === "BALL_ADDED" && payload.extras) {
    errors.push("Ball events cannot include extras; use EXTRA instead.");
  }
  if (type === "WICKET" && !payload.dismissal) {
    errors.push("Wicket events require dismissal details.");
  }
  if (type === "EXTRA" && !payload.extras) {
    errors.push("Extra events require extras payload.");
  }
  const extras = payload.extras;
  if (extras?.type) {
    const extraType = String(extras.type).toUpperCase();
    const runsOffBat = Number(payload.runs || 0);
    if ((extraType === "WD" || extraType === "PEN") && runsOffBat > 0) {
      errors.push("Wides or penalty runs cannot include bat runs.");
    }
    if ((extraType === "B" || extraType === "LB") && runsOffBat > 0) {
      errors.push("Byes or leg byes cannot include bat runs.");
    }
  }
  return errors;
}

async function appendSystemEvent(params: {
  db: Awaited<ReturnType<typeof getDb>>;
  matchId: string;
  inningsNo: number;
  type: "OVER_END" | "INNINGS_END" | "MATCH_END";
  payload?: Record<string, any>;
  over: number;
  ballInOver: number;
  createdBy: string;
  snapshot: any;
  config: ReturnType<typeof getMatchConfig>;
  scorer: { id: string; name: string } | null;
}) {
  const seq = await nextMatchSeq(params.db, params.matchId);
  const doc: ScoreEventDoc = {
    match_id: params.matchId,
    innings_no: params.inningsNo,
    seq,
    over: params.over,
    ball_in_over: params.ballInOver,
    type: params.type,
    payload: params.payload || {},
    created_by: params.createdBy,
    created_at: new Date(),
    idempotency_key: `system_${seq}`,
  };
  await insertScoreEvent(params.db, doc);
  const event: ScoreEvent = {
    matchId: params.matchId,
    inningsNo: params.inningsNo,
    seq,
    over: params.over,
    ballInOver: params.ballInOver,
    type: params.type,
    payload: params.payload || {},
    createdBy: params.createdBy,
    createdAt: doc.created_at.toISOString(),
    idempotencyKey: doc.idempotency_key,
  };
  const nextSnapshot = applyEvent({
    snapshot: params.snapshot,
    event,
    config: params.config,
    scorer: params.scorer || undefined,
  });
  return { event, snapshot: nextSnapshot };
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
  const parsed = ballEventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", details: parsed.error.flatten() }, { status: 400 });
  }

  const { inningsNo, type, payload, idempotencyKey, clientId, clientSeq, expectedVersion } = parsed.data;
  if (!matchId) {
    return NextResponse.json({ error: "matchId is required." }, { status: 400 });
  }

  const ruleErrors = validatePayloadRules(type, payload);
  if (ruleErrors.length) {
    return NextResponse.json({ error: "Invalid payload", details: ruleErrors }, { status: 400 });
  }

  const db = await getDb();
  await ensureScoringIndexes(db);

  const match = await getMatchDoc(db, matchId);
  if (!match) {
    return NextResponse.json({ error: "Match not found." }, { status: 404 });
  }

  const { role, user } = await resolveMatchRole(db, matchId, session.sub);
  if (!hasRolePermission(role, "score")) {
    await writeAuditLog({
      db,
      matchId,
      userId: session.sub,
      action: "ROLE_DENIED",
      details: { action: "score" },
    });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const config = getMatchConfig(match);
  if (!config.overs) {
    return NextResponse.json({ error: "Match overs are not configured." }, { status: 400 });
  }

  const existing = await getEventDocByIdempotency(db, matchId, idempotencyKey);
  if (existing) {
    const snapshotDoc = await getSnapshotDoc(db, matchId, existing.innings_no);
    await commitClientSequence({ db, matchId, clientId, clientSeq });
    return NextResponse.json({
      event: serializeEventDoc(existing),
      snapshot: snapshotDoc ? serializeSnapshotDoc(snapshotDoc) : null,
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
  if (snapshot.status !== "LIVE") {
    return NextResponse.json({ error: "Innings is not live." }, { status: 409 });
  }
  const validation = validateNextAction(snapshot, type);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.errors[0], details: validation.errors }, { status: 409 });
  }

  const seqError = await validateClientSequence({ db, matchId, clientId, clientSeq });
  if (seqError) {
    return NextResponse.json({ error: seqError.error, details: seqError }, { status: 409 });
  }

  if (snapshot.locked) {
    return NextResponse.json({ error: "Match is locked." }, { status: 403 });
  }

  if (!snapshot.strikerId || !snapshot.nonStrikerId || !snapshot.bowlerId) {
    return NextResponse.json({ error: "Striker, non-striker, and bowler are required." }, { status: 409 });
  }

  const dismissedId = payload.dismissal?.playerOutId;
  if (dismissedId && dismissedId !== snapshot.strikerId && dismissedId !== snapshot.nonStrikerId) {
    return NextResponse.json({ error: "Dismissed player must be striker or non-striker." }, { status: 400 });
  }

  const legalDelivery = isLegalDelivery(payload, config);
  if (snapshot.wickets >= 10) {
    return NextResponse.json({ error: "All wickets have fallen." }, { status: 409 });
  }
  if (legalDelivery && snapshot.balls >= config.overs * 6) {
    return NextResponse.json({ error: "Overs limit reached." }, { status: 409 });
  }

  const nextBall = getNextBallLabel(snapshot.balls);
  const seq = await nextMatchSeq(db, matchId);
  const eventDoc: ScoreEventDoc = {
    match_id: matchId,
    innings_no: inningsNo,
    seq,
    over: nextBall.over,
    ball_in_over: nextBall.ballInOver,
    type,
    payload: {
      ...payload,
      strikerId: snapshot.strikerId,
      nonStrikerId: snapshot.nonStrikerId,
      bowlerId: snapshot.bowlerId,
    },
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
    type,
    payload: eventDoc.payload,
    createdBy: session.sub,
    createdAt: eventDoc.created_at.toISOString(),
    idempotencyKey,
  };

  const scorer = user ? { id: user.id, name: user.name } : null;
  let nextSnapshot = applyEvent({ snapshot, event, config, scorer: scorer || undefined });

  const overEnded = legalDelivery && (snapshot.balls + 1) % 6 === 0;
  if (overEnded) {
    const system = await appendSystemEvent({
      db,
      matchId,
      inningsNo,
      type: "OVER_END",
      payload: {},
      over: eventDoc.over,
      ballInOver: eventDoc.ball_in_over,
      createdBy: session.sub,
      snapshot: nextSnapshot,
      config,
      scorer,
    });
    nextSnapshot = system.snapshot;
  }

  const allOut = nextSnapshot.wickets >= 10;
  const oversComplete = nextSnapshot.balls >= config.overs * 6;
  const targetReached =
    nextSnapshot.inningsNo === 2 &&
    nextSnapshot.target !== null &&
    nextSnapshot.target !== undefined &&
    nextSnapshot.runs >= nextSnapshot.target;

  if (allOut || oversComplete) {
    const system = await appendSystemEvent({
      db,
      matchId,
      inningsNo,
      type: "INNINGS_END",
      payload: { reason: allOut ? "all_out" : "overs_complete" },
      over: eventDoc.over,
      ballInOver: eventDoc.ball_in_over,
      createdBy: session.sub,
      snapshot: nextSnapshot,
      config,
      scorer,
    });
    nextSnapshot = system.snapshot;

    await db.collection("managed_matches").updateOne(
      { match_id: matchId },
      {
        $set: {
          status: "innings_break",
          current_innings: inningsNo,
          updated_at: new Date(),
        },
      }
    );
  }

  if (targetReached || (nextSnapshot.inningsNo === 2 && (allOut || oversComplete))) {
    const reason = targetReached
      ? "target_chased"
      : allOut
        ? "all_out"
        : "overs_complete";
    const system = await appendSystemEvent({
      db,
      matchId,
      inningsNo,
      type: "MATCH_END",
      payload: { reason },
      over: eventDoc.over,
      ballInOver: eventDoc.ball_in_over,
      createdBy: session.sub,
      snapshot: nextSnapshot,
      config,
      scorer,
    });
    nextSnapshot = system.snapshot;

    const teams = await db
      .collection("managed_teams")
      .find({ team_id: { $in: [match.team_a_id, match.team_b_id] } })
      .toArray();
    const teamMap = new Map(teams.map((team: any) => [team.team_id, team.name]));
    const battingName = nextSnapshot.battingTeamId
      ? teamMap.get(nextSnapshot.battingTeamId)
      : "";
    const bowlingName = nextSnapshot.bowlingTeamId
      ? teamMap.get(nextSnapshot.bowlingTeamId)
      : "";
    const resultSummary = buildResultSummary({
      battingTeamName: battingName,
      bowlingTeamName: bowlingName,
      runs: nextSnapshot.runs,
      wickets: nextSnapshot.wickets,
      target: nextSnapshot.target || null,
    });

    await db.collection("managed_matches").updateOne(
      { match_id: matchId },
      {
        $set: {
          status: "completed",
          result_summary: resultSummary,
          updated_at: new Date(),
        },
      }
    );
  }

  await persistSnapshot(db, {
    match_id: matchId,
    innings_no: inningsNo,
    snapshot: nextSnapshot,
    last_event_seq: nextSnapshot.version,
  });

  if (nextSnapshot.status === "COMPLETED") {
    await updateTournamentStandings({ db, matchId, latestSnapshot: nextSnapshot });
    try {
      await updateMatchStats({ db, matchId });
    } catch (error) {
      console.error("Failed to update match stats", error);
    }
  }

  const serialized = serializeSnapshotDoc({
    match_id: matchId,
    innings_no: inningsNo,
    snapshot: nextSnapshot,
    last_event_seq: nextSnapshot.version,
    created_at: snapshotDoc.created_at,
    updated_at: new Date(),
  });

  await commitClientSequence({ db, matchId, clientId, clientSeq });

  emitBallAdded(matchId, {
    matchId,
    version: event.seq,
    event: {
      inningsNo,
      seq: event.seq,
      over: event.over,
      ballInOver: event.ballInOver,
      type: event.type,
      payload: event.payload,
    },
  });

  emitSnapshotUpdate(matchId, {
    matchId,
    version: nextSnapshot.version,
    snapshot: serialized,
  });

  await writeAuditLog({
    db,
    matchId,
    userId: session.sub,
    action: "EVENT_ADDED",
    details: { type, seq },
  });

  return NextResponse.json({
    event: serializeEventDoc(eventDoc),
    snapshot: serialized,
    role,
    allowedActions: buildAllowedActions(nextSnapshot, role),
  });
}
