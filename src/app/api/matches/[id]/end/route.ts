import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongo";
import { getAdminSession } from "@/lib/admin-session";
import { emitSnapshotUpdate } from "@/lib/socket";
import { applyEvent, getPlayersPerSide } from "@/lib/scoring/v2/engine";
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
import { buildResultSummary } from "@/lib/scoring/v2/result";
import { commitClientSequence, validateClientSequence, validateExpectedVersion } from "@/lib/scoring/v2/sync";
import type { ScoreEvent } from "@/lib/scoring/v2/types";
import { z } from "zod";

export const dynamic = "force-dynamic";

// Schema for ending match
const endMatchSchema = z.object({
    winnerId: z.string().optional(),
    reason: z.string().optional(),
    clientId: z.string().optional(),
    clientSeq: z.number().int().optional(),
    expectedVersion: z.number().int().optional(),
    idempotencyKey: z.string().optional(),
});

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
    const parsed = endMatchSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: "Invalid payload", details: parsed.error.flatten() }, { status: 400 });
    }

    const { idempotencyKey, reason, clientId, clientSeq, expectedVersion } = parsed.data;
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
            details: { action: "end_match" },
        });
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Idempotency check
    if (idempotencyKey) {
        const existing = await getEventDocByIdempotency(db, matchId, idempotencyKey);
        if (existing) {
            // Return existing
            // Need snapshot. Which one? Last one.
            // Just basic response implies success.
            return NextResponse.json({
                event: serializeEventDoc(existing),
                snapshot: null, // Client will pull
            });
        }
    }

    // Get latest snapshot (could be innings 1 or 2)
    // We need the *current* active innings.
    // Actually, to get snapshot, we need innings number.
    // We can query managed_matches.current_innings
    const currentInningsNo = match.current_innings || 1;
    const snapshotDoc = await getSnapshotDoc(db, matchId, currentInningsNo);

    if (!snapshotDoc) {
        return NextResponse.json({ error: "Match not started properly." }, { status: 409 });
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

    // Create Event
    const eventDoc: ScoreEventDoc = {
        match_id: matchId,
        innings_no: currentInningsNo,
        seq,
        over: snapshot.balls ? Math.floor((snapshot.balls - 1) / 6) : 0,
        ball_in_over: snapshot.balls ? ((snapshot.balls - 1) % 6) + 1 : 0,
        type: "MATCH_END",
        payload: { reason: reason || "manual" },
        created_by: session.sub,
        created_at: new Date(),
        idempotency_key: idempotencyKey || `end_${Date.now()}`,
    };

    await insertScoreEvent(db, eventDoc);

    const event: ScoreEvent = {
        matchId,
        inningsNo: currentInningsNo,
        seq,
        over: eventDoc.over,
        ballInOver: eventDoc.ball_in_over,
        type: "MATCH_END",
        payload: eventDoc.payload,
        createdBy: session.sub,
        createdAt: eventDoc.created_at.toISOString(),
        idempotencyKey: eventDoc.idempotency_key,
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
        innings_no: currentInningsNo,
        snapshot: nextSnapshot,
        last_event_seq: nextSnapshot.version,
    });

    await commitClientSequence({ db, matchId, clientId, clientSeq });

    const teams = await db
        .collection("managed_teams")
        .find({ team_id: { $in: [match.team_a_id, match.team_b_id] } })
        .toArray();
    const teamMap = new Map(teams.map((team: any) => [team.team_id, team.name]));
    const battingName = nextSnapshot.battingTeamId ? teamMap.get(nextSnapshot.battingTeamId) : "";
    const bowlingName = nextSnapshot.bowlingTeamId ? teamMap.get(nextSnapshot.bowlingTeamId) : "";
    const playersPerSide = getPlayersPerSide(config, nextSnapshot.battingTeamId);
    const resultSummary = buildResultSummary({
        battingTeamName: battingName,
        bowlingTeamName: bowlingName,
        runs: nextSnapshot.runs,
        wickets: nextSnapshot.wickets,
        target: nextSnapshot.target || null,
        playersPerSide,
    });

    await db.collection("managed_matches").updateOne(
        { match_id: matchId },
        {
            $set: {
                status: "completed",
                updated_at: new Date(),
                result_summary: resultSummary,
                // Should we store winner_id in managed_matches?
                // Yes if snapshot has it.
                ...(nextSnapshot.winnerId ? { winner_id: nextSnapshot.winnerId } : {}),
                ...(nextSnapshot.matchResult ? { result: nextSnapshot.matchResult } : {}),
            },
        }
    );

    await writeAuditLog({
        db,
        matchId,
        userId: session.sub,
        action: "MATCH_END",
        details: { seq, result: nextSnapshot.matchResult },
    });

    const serialized = serializeSnapshotDoc({
        match_id: matchId,
        innings_no: currentInningsNo,
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
