import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongo";
import { getCached, setCached } from "@/lib/hot-cache";

const CACHE_TTL_MS = 60_000;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tournamentId = String(searchParams.get("tournamentId") || "").trim();
  const teamId = String(searchParams.get("teamId") || "").trim();

  if (!tournamentId) {
    return NextResponse.json({ error: "tournamentId is required." }, { status: 400 });
  }

  const cacheKey = teamId
    ? `team:${teamId}:tournament:${tournamentId}`
    : `team:tournament:${tournamentId}`;
  const cached = getCached<Record<string, any>>(cacheKey);
  if (cached) {
    return NextResponse.json(cached, {
      headers: { "Cache-Control": "public, max-age=60" },
    });
  }

  const db = await getDb();

  if (teamId) {
    const doc = await db
      .collection("team_tournament_stats")
      .findOne({ tournament_id: tournamentId, team_id: teamId });
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

  const docs = await db
    .collection("team_tournament_stats")
    .find({ tournament_id: tournamentId })
    .sort({ team_name: 1 })
    .toArray();

  const payload = {
    teams: docs.map((doc: any) => {
      const { _id: removed, ...rest } = doc;
      return rest;
    }),
  };
  setCached(cacheKey, payload, CACHE_TTL_MS);
  return NextResponse.json(payload, {
    headers: { "Cache-Control": "public, max-age=60" },
  });
}
