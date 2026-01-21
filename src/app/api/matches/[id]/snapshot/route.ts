import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongo";
import { getAdminSession } from "@/lib/admin-session";
import {
  ensureScoringIndexes,
  getLatestSnapshotDoc,
  getSnapshotDoc,
  serializeSnapshotDoc,
} from "@/lib/scoring/v2/store";
import { buildAllowedActions, resolveMatchRole } from "@/lib/scoring/v2/roles";
import type { MatchSnapshot } from "@/lib/scoring/v2/types";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const matchId = String(id || "").trim();
  if (!matchId) {
    return NextResponse.json({ error: "matchId is required." }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const inningsNoRaw = searchParams.get("inningsNo");
  const inningsNo = inningsNoRaw ? Number(inningsNoRaw) : null;
  if (inningsNoRaw && (inningsNo === null || !Number.isFinite(inningsNo) || inningsNo <= 0)) {
    return NextResponse.json({ error: "Invalid inningsNo." }, { status: 400 });
  }

  const db = await getDb();
  await ensureScoringIndexes(db);

  const doc = inningsNo
    ? await getSnapshotDoc(db, matchId, inningsNo)
    : await getLatestSnapshotDoc(db, matchId);

  if (!doc) {
    return NextResponse.json({ snapshot: null }, { status: 404 });
  }

  // Auto-heal: If runsPerOver is missing (old snapshot), isolate and rebuild.
  // This ensures past matches get the new analytics data.
  if (!doc.snapshot.runsPerOver) {
    console.log(`[AutoHeal] Rebuilding snapshot for ${matchId} to add runsPerOver...`);
    const { getEventsForInnings, persistSnapshot, mapEventDoc } = await import("@/lib/scoring/v2/store");
    const { applyEvent, buildInitialSnapshot } = await import("@/lib/scoring/v2/engine");

    // Fetch all events
    const events = await getEventsForInnings(db, matchId, doc.innings_no);

    // Replay with correct signature
    let freshSnapshot = buildInitialSnapshot({
      matchId,
      inningsNo: doc.innings_no,
      strikerId: doc.snapshot.strikerId || "",
      nonStrikerId: doc.snapshot.nonStrikerId || "",
      bowlerId: doc.snapshot.bowlerId || "",
      battingTeamId: doc.snapshot.battingTeamId || "",
      bowlingTeamId: doc.snapshot.bowlingTeamId || "",
      oversConfig: doc.snapshot.oversConfig || 20,
      settings: doc.snapshot.settings || {},
      previousInnings: doc.snapshot.previousInnings || null,
      target: doc.snapshot.target || null,
    });

    const config = {
      overs: doc.snapshot.oversConfig || 20,
      settings: doc.snapshot.settings || {},
    };

    for (const eventDoc of events) {
      const event = mapEventDoc(eventDoc);
      freshSnapshot = applyEvent({
        snapshot: freshSnapshot,
        event,
        config,
        scorer: doc.snapshot.scorer || null,
      });
    }

    // Persist and use the fresh one
    await persistSnapshot(db, {
      match_id: matchId,
      innings_no: doc.innings_no,
      snapshot: freshSnapshot,
      last_event_seq: events.length > 0 ? events[events.length - 1].seq : 0,
    });

    doc.snapshot = freshSnapshot;
  }

  const session = await getAdminSession();
  const { role, user } = await resolveMatchRole(db, matchId, session?.sub || null);
  const payload = serializeSnapshotDoc(doc) as MatchSnapshot;
  payload.allowedActions = buildAllowedActions(payload, role);

  return NextResponse.json({ snapshot: payload, role, user });
}
