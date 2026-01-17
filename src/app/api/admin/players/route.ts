import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongo";
import { getAdminSession } from "@/lib/admin-session";
import { buildPrefixes, normalizeSearchText } from "@/lib/search";
import crypto from "crypto";

export async function GET(request: Request) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const query = String(searchParams.get("q") || "").trim().toLowerCase();

  const db = await getDb();
  const [meta, customPlayers] = await Promise.all([
    db.collection("meta").findOne({ key: "global_player_database" }),
    db.collection("custom_players").find({}).sort({ created_at: -1 }).toArray(),
  ]);

  const players = meta?.data?.players || {};

  const mappedGlobals = Object.values(players).map((player: any) => ({
    player_id: player.player_id,
    name: player.profile?.name || "Unknown",
    city: player.profile?.city_name || "",
    role: player.profile?.playing_role || "",
    batting_hand: player.profile?.batting_hand || "",
    bowling_style: player.profile?.bowling_style || "",
    source: "global",
  }));

  const mappedCustom = customPlayers.map((player: any) => ({
    player_id: player.player_id,
    name: player.profile?.name || "Unknown",
    city: player.profile?.city_name || "",
    role: player.profile?.playing_role || "",
    batting_hand: player.profile?.batting_hand || "",
    bowling_style: player.profile?.bowling_style || "",
    source: "custom",
  }));

  const merged = [...mappedCustom, ...mappedGlobals];

  const result = merged
    .filter((player: any) => {
      if (!query) return true;
      return (
        player.name.toLowerCase().includes(query) ||
        player.city.toLowerCase().includes(query) ||
        player.role.toLowerCase().includes(query)
      );
    })
    .slice(0, 500);

  return NextResponse.json({ players: result });
}

export async function POST(request: Request) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  const city = String(body.city || "").trim();
  const role = String(body.role || "").trim();
  const battingHand = String(body.batting_hand || "").trim();
  const bowlingStyle = String(body.bowling_style || "").trim();

  if (!name) {
    return NextResponse.json({ error: "Player name is required." }, { status: 400 });
  }

  const playerId = `cp_${crypto.randomUUID()}`;
  const doc = {
    player_id: playerId,
    profile: {
      name,
      city_name: city,
      playing_role: role,
      batting_hand: battingHand,
      bowling_style: bowlingStyle,
    },
    created_by: session.sub,
    created_at: new Date(),
  };

  const db = await getDb();
  await db.collection("custom_players").insertOne(doc);
  const searchName = normalizeSearchText(`${name} ${city}`.trim());
  const searchPrefixes = buildPrefixes(`${name} ${city}`.trim());
  const cityPrefixes = city ? buildPrefixes(city) : [];
  await db.collection("search_players").updateOne(
    { player_id: playerId },
    {
      $set: {
        player_id: playerId,
        name,
        city,
        role,
        batting_hand: battingHand,
        bowling_style: bowlingStyle,
        photo: "",
        tournaments: 0,
        source: "custom",
        search_name: searchName,
        search_prefixes: searchPrefixes,
        city_prefixes: cityPrefixes,
        updated_at: new Date(),
      },
      $setOnInsert: { created_at: new Date() },
    },
    { upsert: true }
  );

  return NextResponse.json({
    player: {
      player_id: playerId,
      name,
      city,
      role,
      batting_hand: battingHand,
      bowling_style: bowlingStyle,
      source: "custom",
    },
  });
}
