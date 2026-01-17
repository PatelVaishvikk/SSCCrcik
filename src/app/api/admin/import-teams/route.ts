import { NextResponse } from "next/server";
import crypto from "crypto";
import { getDb } from "@/lib/mongo";
import { getAdminSession } from "@/lib/admin-session";
import { buildPrefixes, normalizeSearchText } from "@/lib/search";

type TeamEntry = {
  team_id: string;
  team_name: string;
  players: Array<{ player_id: string; player_name: string; profile_photo?: string }>;
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

  if (!results.size) {
    const schedule = eventDoc?.combined?.schedule || [];
    schedule.forEach((match: any) => {
      const teamAKey = String(match.team_a_id || match.team_a || "").trim();
      const teamBKey = String(match.team_b_id || match.team_b || "").trim();
      if (teamAKey && !results.has(teamAKey)) {
        results.set(teamAKey, {
          team_id: teamAKey,
          team_name: match.team_a || teamAKey,
          players: [],
        });
      }
      if (teamBKey && !results.has(teamBKey)) {
        results.set(teamBKey, {
          team_id: teamBKey,
          team_name: match.team_b || teamBKey,
          players: [],
        });
      }
    });
  }

  return Array.from(results.values());
}

export async function POST(request: Request) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const targetTournamentId = String(body.tournamentId || "").trim();
  const eventId = String(body.eventId || "").trim();
  const teamIds: string[] = Array.isArray(body.teamIds)
    ? body.teamIds.map((id: string) => String(id))
    : [];

  if (!targetTournamentId || !eventId || !teamIds.length) {
    return NextResponse.json(
      { error: "tournamentId, eventId, and teamIds are required." },
      { status: 400 }
    );
  }

  const db = await getDb();
  const eventDoc = await db.collection("events").findOne({ event_id: eventId });
  if (!eventDoc) {
    return NextResponse.json({ error: "Event not found." }, { status: 404 });
  }

  const availableTeams = extractTeams(eventDoc);
  const teamMap = new Map(availableTeams.map((team) => [team.team_id, team]));
  const selectedTeams = teamIds.map((id) => teamMap.get(id)).filter(Boolean) as TeamEntry[];

  if (!selectedTeams.length) {
    return NextResponse.json({ error: "No matching teams found." }, { status: 400 });
  }

  const existing = await db
    .collection("managed_teams")
    .find({ tournament_id: targetTournamentId })
    .toArray();
  const existingNames = new Set(
    existing.map((team: any) => String(team.name || "").toLowerCase())
  );

  const meta = await db.collection("meta").findOne({ key: "global_player_database" });
  const globalPlayers = meta?.data?.players || {};
  const customPlayersCol = db.collection("custom_players");
  const customPlayers = await customPlayersCol.find({}).toArray();
  const customById = new Map(customPlayers.map((player: any) => [String(player.player_id), player]));

  const ensurePlayer = async (player: {
    player_id: string;
    player_name: string;
    profile_photo?: string;
  }) => {
    const rawId = String(player.player_id || "").trim();
    const name = player.player_name || "Unknown";
    if (rawId && globalPlayers[rawId]) return rawId;
    if (rawId && customById.has(rawId)) return rawId;
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
    return newId;
  };

  const created: any[] = [];
  const skipped: any[] = [];

  for (const team of selectedTeams) {
    const teamName = String(team.team_name || "").trim();
    if (!teamName) continue;
    if (existingNames.has(teamName.toLowerCase())) {
      skipped.push({ team_name: teamName, reason: "already_exists" });
      continue;
    }

    const playerIds: string[] = [];
    const seenPlayers = new Set<string>();
    for (const player of team.players || []) {
      const id = await ensurePlayer(player);
      if (id && !seenPlayers.has(id)) {
        playerIds.push(id);
        seenPlayers.add(id);
      }
    }

    const shortName = teamName.slice(0, 3).toUpperCase();
    const searchName = normalizeSearchText(`${teamName} ${shortName}`.trim());
    const searchPrefixes = buildPrefixes(`${teamName} ${shortName}`.trim());
    const teamDoc = {
      team_id: `team_${crypto.randomUUID()}`,
      tournament_id: targetTournamentId,
      name: teamName,
      short_name: shortName,
      captain_id: null,
      vice_captain_id: null,
      player_ids: playerIds,
      search_name: searchName,
      search_prefixes: searchPrefixes,
      source_event_id: eventId,
      source_team_id: team.team_id,
      created_by: session.sub,
      created_at: new Date(),
    };

    await db.collection("managed_teams").insertOne(teamDoc);
    created.push(teamDoc);
    existingNames.add(teamName.toLowerCase());
  }

  return NextResponse.json({ created, skipped });
}
