import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongo";
import { getAdminSession } from "@/lib/admin-session";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const matchId = String(id || "").trim();
  if (!matchId) {
    return NextResponse.json({ error: "matchId is required." }, { status: 400 });
  }

  const db = await getDb();
  const match = await db.collection("managed_matches").findOne({ match_id: matchId });
  if (!match) {
    return NextResponse.json({ error: "Match not found." }, { status: 404 });
  }

  const teamIds = [match.team_a_id, match.team_b_id].filter(Boolean);
  const teams = await db
    .collection("managed_teams")
    .find({ team_id: { $in: teamIds } })
    .toArray();

  const squadIds = Array.from(
    new Set([...(match.squad_a_ids || []), ...(match.squad_b_ids || [])])
  );

  const projection: Record<string, number> = { _id: 0 };
  squadIds.forEach((playerId) => {
    projection[`data.players.${playerId}`] = 1;
  });

  const [meta, customPlayers] = await Promise.all([
    squadIds.length
      ? db.collection("meta").findOne({ key: "global_player_database" }, { projection })
      : null,
    squadIds.length
      ? db.collection("custom_players").find({ player_id: { $in: squadIds } }).toArray()
      : [],
  ]);

  const globals = meta?.data?.players || {};
  const mappedGlobals = squadIds
    .map((playerId: string) => globals[playerId])
    .filter(Boolean)
    .map((player: any) => ({
      player_id: player.player_id,
      name: player.profile?.name || "Unknown",
      role: player.profile?.playing_role || "",
    }));

  const mappedCustom = customPlayers.map((player: any) => ({
    player_id: player.player_id,
    name: player.profile?.name || "Unknown",
    role: player.profile?.playing_role || "",
  }));

  const players = [...mappedCustom, ...mappedGlobals];

  const { _id, ...matchPayload } = match;
  const teamsPayload = teams.map((team: any) => {
    const { _id: teamId, ...rest } = team;
    return rest;
  });

  return NextResponse.json(
    {
      match: matchPayload,
      teams: teamsPayload,
      players,
    },
    {
      headers: {
        "Cache-Control": "private, max-age=60",
      },
    }
  );
}
