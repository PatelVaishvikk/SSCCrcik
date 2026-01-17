import { NextResponse } from "next/server";
import crypto from "crypto";
import { getDb } from "@/lib/mongo";
import { getAdminSession } from "@/lib/admin-session";
import { buildPrefixes, normalizeSearchText } from "@/lib/search";

type PlayerEntry = {
  player_id: string;
  player_name: string;
  profile_photo?: string;
};

type TeamEntry = {
  team_id: string;
  team_name: string;
  players: PlayerEntry[];
};

function extractTeams(eventDoc: any): TeamEntry[] {
  const results = new Map<string, TeamEntry>();
  const combinedTeams = eventDoc?.combined?.teams || [];

  const addTeam = (team: any) => {
    if (!team) return;
    const rawId = team.team_id ?? team.teamId ?? team.id;
    const name = team.team_name || team.name || team.teamName;
    const key = String(rawId ?? name ?? "").trim();
    if (!key || results.has(key)) return;
    const players = Array.isArray(team.players)
      ? team.players.map((player: any) => ({
          player_id: String(player.player_id || player.id || ""),
          player_name: String(player.player_name || player.name || "Unknown"),
          profile_photo: player.profile_photo || "",
        }))
      : [];
    results.set(key, {
      team_id: key,
      team_name: String(name || key),
      players,
    });
  };

  for (const entry of combinedTeams) {
    const teamResponse = entry?.data?.pageProps?.teamResponse?.data;
    if (teamResponse && typeof teamResponse === "object") {
      Object.values(teamResponse).forEach(addTeam);
    }
  }

  return Array.from(results.values());
}

export async function POST(request: Request) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const eventId = String(body.eventId || "").trim();
  const teamId = String(body.teamId || "").trim();

  if (!eventId || !teamId) {
    return NextResponse.json(
      { error: "eventId and teamId are required." },
      { status: 400 }
    );
  }

  const db = await getDb();
  const eventDoc = await db.collection("events").findOne({ event_id: eventId });
  if (!eventDoc) {
    return NextResponse.json({ error: "Event not found." }, { status: 404 });
  }

  const teams = extractTeams(eventDoc);
  const team = teams.find((entry) => entry.team_id === teamId);
  if (!team) {
    return NextResponse.json({ error: "Team not found." }, { status: 404 });
  }

  const meta = await db.collection("meta").findOne({ key: "global_player_database" });
  const globalPlayers = meta?.data?.players || {};
  const globalByName = new Map<string, string>();
  Object.entries(globalPlayers).forEach(([id, player]: [string, any]) => {
    const name = String(player?.profile?.name || "").trim().toLowerCase();
    if (name && !globalByName.has(name)) {
      globalByName.set(name, id);
    }
  });

  const customPlayersCol = db.collection("custom_players");
  const customPlayers = await customPlayersCol.find({}).toArray();
  const customById = new Map(customPlayers.map((player: any) => [String(player.player_id), player]));
  const customByName = new Map<string, string>();
  customPlayers.forEach((player: any) => {
    const name = String(player?.profile?.name || "").trim().toLowerCase();
    if (name && !customByName.has(name)) {
      customByName.set(name, String(player.player_id));
    }
  });

  const createdPlayers: any[] = [];

  const ensurePlayer = async (player: PlayerEntry) => {
    const rawId = String(player.player_id || "").trim();
    const name = String(player.player_name || "Unknown").trim();
    if (rawId && globalPlayers[rawId]) return rawId;
    if (rawId && customById.has(rawId)) return rawId;
    const nameKey = name.toLowerCase();
    if (nameKey && globalByName.has(nameKey)) return globalByName.get(nameKey) as string;
    if (nameKey && customByName.has(nameKey)) return customByName.get(nameKey) as string;

    const newId = rawId || `cp_${crypto.randomUUID()}`;
    const doc = {
      player_id: newId,
      profile: {
        name,
        profile_photo: player.profile_photo || "",
      },
      created_by: session.sub,
      created_at: new Date(),
    };
    await customPlayersCol.insertOne(doc);
    const searchName = normalizeSearchText(name);
    const searchPrefixes = buildPrefixes(name);
    await db.collection("search_players").updateOne(
      { player_id: newId },
      {
        $set: {
          player_id: newId,
          name,
          city: "",
          role: "",
          batting_hand: "",
          bowling_style: "",
          photo: player.profile_photo || "",
          tournaments: 0,
          source: "custom",
          search_name: searchName,
          search_prefixes: searchPrefixes,
          city_prefixes: [],
          updated_at: new Date(),
        },
        $setOnInsert: { created_at: new Date() },
      },
      { upsert: true }
    );
    customById.set(newId, doc);
    if (nameKey) {
      customByName.set(nameKey, newId);
    }
    createdPlayers.push({
      player_id: newId,
      name,
      city: "",
      role: "",
      batting_hand: "",
      bowling_style: "",
      source: "custom",
    });
    return newId;
  };

  const playerIds: string[] = [];
  const seen = new Set<string>();
  for (const player of team.players || []) {
    const id = await ensurePlayer(player);
    if (id && !seen.has(id)) {
      playerIds.push(id);
      seen.add(id);
    }
  }

  return NextResponse.json({ playerIds, createdPlayers });
}
