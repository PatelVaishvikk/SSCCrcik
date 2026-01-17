import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongo";
import { getAdminSession } from "@/lib/admin-session";

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

  return Array.from(results.values()).sort((a, b) =>
    a.team_name.localeCompare(b.team_name)
  );
}

export async function GET(request: Request) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const eventId = searchParams.get("eventId");
  if (!eventId) {
    return NextResponse.json({ error: "eventId is required." }, { status: 400 });
  }

  const db = await getDb();
  const eventDoc = await db.collection("events").findOne({ event_id: eventId });
  if (!eventDoc) {
    return NextResponse.json({ error: "Event not found." }, { status: 404 });
  }

  const teams = extractTeams(eventDoc);

  return NextResponse.json({ teams });
}
