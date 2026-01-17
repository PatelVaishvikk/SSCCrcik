import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongo";
import { getCached, setCached } from "@/lib/hot-cache";

const CACHE_TTL_MS = 60_000;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ matchId: string }> }
) {
  const { matchId } = await params;
  const trimmed = String(matchId || "").trim();
  if (!trimmed) {
    return NextResponse.json({ error: "matchId is required." }, { status: 400 });
  }

  const cacheKey = `analytics:match:${trimmed}`;
  const cached = getCached<Record<string, any>>(cacheKey);
  if (cached) {
    return NextResponse.json(cached, {
      headers: { "Cache-Control": "public, max-age=60" },
    });
  }

  const db = await getDb();
  const doc = await db.collection("match_analytics").findOne({ match_id: trimmed });
  if (!doc) {
    return NextResponse.json({ analytics: null }, { status: 404 });
  }

  const { _id, ...payload } = doc as Record<string, any>;
  const response = { analytics: payload };
  setCached(cacheKey, response, CACHE_TTL_MS);
  return NextResponse.json(response, {
    headers: { "Cache-Control": "public, max-age=60" },
  });
}
