import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongo";
import { getCached, setCached } from "@/lib/hot-cache";

const CACHE_TTL_MS = 60_000;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tournamentId = String(searchParams.get("tournamentId") || "").trim();

  if (!tournamentId) {
    return NextResponse.json({ error: "tournamentId is required." }, { status: 400 });
  }

  const cacheKey = `leaderboards:${tournamentId}`;
  const cached = getCached<Record<string, any>>(cacheKey);
  if (cached) {
    return NextResponse.json(cached, {
      headers: { "Cache-Control": "public, max-age=60" },
    });
  }

  const db = await getDb();
  const doc = await db
    .collection("tournament_leaderboards")
    .findOne({ tournament_id: tournamentId });

  if (!doc) {
    return NextResponse.json({ leaderboards: null }, { status: 404 });
  }

  const { _id, ...payload } = doc as Record<string, any>;
  setCached(cacheKey, payload, CACHE_TTL_MS);
  return NextResponse.json(payload, {
    headers: { "Cache-Control": "public, max-age=60" },
  });
}
