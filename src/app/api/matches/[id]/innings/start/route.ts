import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongo";
import { getAdminSession } from "@/lib/admin-session";
import { emitSnapshotUpdate } from "@/lib/socket";
import { buildInitialSnapshot } from "@/lib/scoring/v2/engine";
import {
  ensureScoringIndexes,
  getEventDocByIdempotency,
  getLatestSnapshotDoc,
  getSnapshotDoc,
  insertScoreEvent,
  nextMatchSeq,
  persistSnapshot,
  serializeEventDoc,
  serializeSnapshotDoc,
  type ScoreEventDoc,
} from "@/lib/scoring/v2/store";
import { inningsStartSchema } from "@/lib/scoring/v2/schemas";
import { getMatchConfig, getMatchDoc, isPlayerInXI, validateMatchSetup } from "@/lib/scoring/v2/match";
import { buildAllowedActions, resolveMatchRole, hasRolePermission } from "@/lib/scoring/v2/roles";
import { writeAuditLog } from "@/lib/scoring/v2/audit";
import { commitClientSequence, validateClientSequence, validateExpectedVersion } from "@/lib/scoring/v2/sync";

export const dynamic = "force-dynamic";

function resolveExpectedTeams(match: any, inningsNo: number) {
  const teamA = match.team_a_id;
  const teamB = match.team_b_id;
  if (inningsNo === 1) {
    const tossWinner = match.toss_winner_id;
    const decision = String(match.toss_decision || "").toLowerCase();
    if (decision === "bat") {
      return { battingTeamId: tossWinner, bowlingTeamId: tossWinner === teamA ? teamB : teamA };
    }
    if (decision === "bowl") {
      return { battingTeamId: tossWinner === teamA ? teamB : teamA, bowlingTeamId: tossWinner };
    }
  }
  if (inningsNo === 2 && match.innings1_batting_team_id) {
    const innings1Bat = match.innings1_batting_team_id;
    const innings2Bat = innings1Bat === teamA ? teamB : teamA;
    return { battingTeamId: innings2Bat, bowlingTeamId: innings1Bat };
  }
  return { battingTeamId: null, bowlingTeamId: null };
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
  if (!matchId) {
    return NextResponse.json({ error: "matchId is required." }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = inningsStartSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", details: parsed.error.flatten() }, { status: 400 });
  }

  const {
    inningsNo,
    idempotencyKey,
    strikerId,
    nonStrikerId,
    bowlerId,
    battingTeamId,
    bowlingTeamId,
    clientId,
    clientSeq,
    expectedVersion,
  } = parsed.data;

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
      details: { action: "start_innings" },
    });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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

  const setupErrors = validateMatchSetup(match);
  if (setupErrors.length) {
    return NextResponse.json({ error: setupErrors[0], details: setupErrors }, { status: 400 });
  }

  if (inningsNo === 1 && match.status && match.status !== "scheduled") {
    return NextResponse.json({ error: "Match has already started." }, { status: 409 });
  }
  if (inningsNo === 2 && match.status !== "innings_break") {
    return NextResponse.json({ error: "Innings 2 is not ready to start." }, { status: 409 });
  }

  const existingSnapshot = await getSnapshotDoc(db, matchId, inningsNo);
  if (existingSnapshot) {
    return NextResponse.json({ error: "Innings already started." }, { status: 409 });
  }

  const latestSnapshot = await getLatestSnapshotDoc(db, matchId);
  const versionError = validateExpectedVersion(latestSnapshot?.snapshot || null, expectedVersion);
  if (versionError) {
    return NextResponse.json({ error: versionError.error, details: versionError }, { status: 409 });
  }

  const expected = resolveExpectedTeams(match, inningsNo);
  if (expected.battingTeamId && expected.battingTeamId !== battingTeamId) {
    return NextResponse.json({ error: "Batting team does not match toss result." }, { status: 400 });
  }
  if (expected.bowlingTeamId && expected.bowlingTeamId !== bowlingTeamId) {
    return NextResponse.json({ error: "Bowling team does not match toss result." }, { status: 400 });
  }

  if (strikerId === nonStrikerId) {
    return NextResponse.json({ error: "Striker and non-striker must be different." }, { status: 400 });
  }

  if (!isPlayerInXI(match, battingTeamId, strikerId)) {
    return NextResponse.json({ error: "Striker must be in batting XI." }, { status: 400 });
  }
  if (!isPlayerInXI(match, battingTeamId, nonStrikerId)) {
    return NextResponse.json({ error: "Non-striker must be in batting XI." }, { status: 400 });
  }
  if (!isPlayerInXI(match, bowlingTeamId, bowlerId)) {
    return NextResponse.json({ error: "Bowler must be in bowling XI." }, { status: 400 });
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
    over: 0,
    ball_in_over: 0,
    type: "INNINGS_START",
    payload: {
      strikerId,
      nonStrikerId,
      bowlerId,
      battingTeamId,
      bowlingTeamId,
    },
    created_by: session.sub,
    created_at: new Date(),
    idempotency_key: idempotencyKey,
  };

  await insertScoreEvent(db, eventDoc);

  let previousInnings = null;
  let target = null;
  if (inningsNo === 2) {
    const innings1 = await getSnapshotDoc(db, matchId, 1);
    if (!innings1) {
      return NextResponse.json({ error: "Innings 1 has not completed." }, { status: 409 });
    }
    previousInnings = innings1.snapshot.inningsSummary || {
      runs: innings1.snapshot.runs,
      wickets: innings1.snapshot.wickets,
      overs: innings1.snapshot.overs,
      runRate: innings1.snapshot.runRate,
    };
    target = innings1.snapshot.target ?? innings1.snapshot.runs + 1;
  }

  const snapshot = buildInitialSnapshot({
    matchId,
    inningsNo,
    strikerId,
    nonStrikerId,
    bowlerId,
    battingTeamId,
    bowlingTeamId,
    oversConfig: config.overs,
    settings: config.settings,
    previousInnings,
    target,
  });
  snapshot.version = seq;
  if (user) snapshot.scorer = { id: user.id, name: user.name };

  await persistSnapshot(db, {
    match_id: matchId,
    innings_no: inningsNo,
    snapshot,
    last_event_seq: seq,
  });

  await commitClientSequence({ db, matchId, clientId, clientSeq });

  await db.collection("managed_matches").updateOne(
    { match_id: matchId },
    {
      $set: {
        status: "live",
        current_innings: inningsNo,
        innings1_batting_team_id:
          inningsNo === 1 ? battingTeamId : match.innings1_batting_team_id,
        innings1_bowling_team_id:
          inningsNo === 1 ? bowlingTeamId : match.innings1_bowling_team_id,
        updated_at: new Date(),
      },
    }
  );

  await writeAuditLog({
    db,
    matchId,
    userId: session.sub,
    action: "INNINGS_START",
    details: { inningsNo, seq },
  });

  const serialized = serializeSnapshotDoc({
    match_id: matchId,
    innings_no: inningsNo,
    snapshot,
    last_event_seq: seq,
    created_at: eventDoc.created_at,
    updated_at: eventDoc.created_at,
  });

  emitSnapshotUpdate(matchId, { matchId, version: snapshot.version, snapshot: serialized });

  return NextResponse.json({
    event: serializeEventDoc(eventDoc),
    snapshot: serialized,
    role,
    allowedActions: buildAllowedActions(snapshot, role),
  });
}
