import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongo";

export const dynamic = "force-dynamic";

const MAX_LIMIT = 100;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = String(searchParams.get("q") || "").trim().toLowerCase();
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(searchParams.get("limit") || 24))
  );
  const offset = Math.max(0, Number(searchParams.get("offset") || 0));

  const db = await getDb();
  const [meta, customPlayers] = await Promise.all([
    db.collection("meta").findOne({ key: "player_history" }),
    db.collection("custom_players").find({}).toArray(),
  ]);

  const players = meta?.data?.players || {};
  const globals = Object.values(players).map((player: any) => ({
    id: String(player.player_id),
    name: player.profile?.name || "Unknown",
    city: player.profile?.city_name || "",
    role: player.profile?.playing_role || player.profile?.batting_hand || "",
    tournaments: player.ssc_tournaments_played || 0,
    photo: player.profile?.profile_photo || "",
  }));

  const customs = customPlayers.map((player: any) => ({
    id: String(player.player_id),
    name: player.profile?.name || "Unknown",
    city: player.profile?.city_name || "",
    role: player.profile?.playing_role || player.profile?.batting_hand || "",
    tournaments: player.ssc_tournaments_played || 0,
    photo: player.profile?.profile_photo || "",
  }));

  const merged = [...customs, ...globals];
  const filtered = query
    ? merged.filter((player) => player.name.toLowerCase().includes(query))
    : merged;
  const total = filtered.length;
  const sorted = filtered.sort((a, b) => a.name.localeCompare(b.name));
  const page = sorted.slice(offset, offset + limit);

  return NextResponse.json(
    { players: page, total, hasMore: offset + limit < total },
    { headers: { "Cache-Control": "no-store" } }
  );
}
