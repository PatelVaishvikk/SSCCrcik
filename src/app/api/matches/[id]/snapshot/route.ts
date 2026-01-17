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
  if (inningsNoRaw && (!Number.isFinite(inningsNo) || inningsNo <= 0)) {
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
    const { getEventsForInnings, persistSnapshot } = await import("@/lib/scoring/v2/store");
    const { applyEvent, buildInitialSnapshot } = await import("@/lib/scoring/v2/engine");
    const { mapEventDoc } = await import("@/lib/scoring/v2/store");

    // Fetch all events
    const events = await getEventsForInnings(db, matchId, doc.innings_no);

    // Replay
    let freshSnapshot = buildInitialSnapshot({
      matchId,
      inningsNo: doc.innings_no,
      overs: doc.snapshot.oversConfig || 0, // Fallback if needed, though initial snapshot usually takes config
      settings: doc.snapshot.settings || {},
    });
    // Wait, buildInitialSnapshot signature might be different. Let's check engine.ts export.
    // Actually, checking engine.ts lines 55+: export function buildInitialSnapshot(params: MatchConfig & { matchId: string; ... })
    // It requires config. We can try to reuse doc.snapshot's config.

    freshSnapshot = buildInitialSnapshot({
      matchId,
      inningsNo: doc.innings_no,
      overs: doc.snapshot.oversConfig || 20,
      settings: doc.snapshot.settings || {},
    });

    for (const eventDoc of events) {
      const event = mapEventDoc(eventDoc);
      freshSnapshot = applyEvent(freshSnapshot, event);
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
