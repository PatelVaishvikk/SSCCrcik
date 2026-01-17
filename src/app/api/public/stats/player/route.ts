import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongo";
import { getCached, setCached } from "@/lib/hot-cache";

const CACHE_TTL_MS = 60_000;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const playerId = String(searchParams.get("playerId") || "").trim();
  const tournamentId = String(searchParams.get("tournamentId") || "").trim();

  if (!playerId) {
    return NextResponse.json({ error: "playerId is required." }, { status: 400 });
  }

  const cacheKey = tournamentId
    ? `player:${playerId}:tournament:${tournamentId}`
    : `player:${playerId}:career`;
  const cached = getCached<Record<string, any>>(cacheKey);
  if (cached) {
    return NextResponse.json(cached, {
      headers: { "Cache-Control": "public, max-age=60" },
    });
  }

  const db = await getDb();

  if (tournamentId) {
    const doc = await db
      .collection("player_tournament_stats")
      .findOne({ tournament_id: tournamentId, player_id: playerId });
    if (!doc) {
      return NextResponse.json({ stats: null }, { status: 404 });
    }
    const { _id, ...payload } = doc as Record<string, any>;
    const response = { stats: payload };
    setCached(cacheKey, response, CACHE_TTL_MS);
    return NextResponse.json(response, {
      headers: { "Cache-Control": "public, max-age=60" },
    });
  }

  const [career, tournaments] = await Promise.all([
    db.collection("player_career_stats").findOne({ player_id: playerId }),
    db
      .collection("player_tournament_stats")
      .find({ player_id: playerId })
      .sort({ updated_at: -1 })
      .toArray(),
  ]);

  if (!career) {
    return NextResponse.json({ stats: null }, { status: 404 });
  }

  const { _id, ...careerPayload } = career as Record<string, any>;
  const payload = {
    career: careerPayload,
    tournaments: tournaments.map((doc: any) => {
      const { _id: removed, ...rest } = doc;
      return rest;
    }),
  };
  setCached(cacheKey, payload, CACHE_TTL_MS);
  return NextResponse.json(payload, {
    headers: { "Cache-Control": "public, max-age=60" },
  });
}
