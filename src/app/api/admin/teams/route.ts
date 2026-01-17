import { NextResponse } from "next/server";
import crypto from "crypto";
import { getDb } from "@/lib/mongo";
import { getAdminSession } from "@/lib/admin-session";
import { buildPrefixes, normalizeSearchText } from "@/lib/search";

export async function GET(request: Request) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const tournamentId = searchParams.get("tournamentId");
  const includeAll = searchParams.get("includeAll") === "true";

  if (!includeAll && !tournamentId) {
    return NextResponse.json({ error: "tournamentId is required." }, { status: 400 });
  }

  const db = await getDb();
  const teams = await db
    .collection("managed_teams")
    .find(includeAll ? {} : { tournament_id: tournamentId })
    .sort({ created_at: -1 })
    .toArray();

  const payload = teams.map((doc) => {
    const { _id, ...rest } = doc;
    return rest;
  });

  return NextResponse.json({ teams: payload });
}

export async function POST(request: Request) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const tournamentId = String(body.tournamentId || "").trim();
  const name = String(body.name || "").trim();
  const shortName = String(body.shortName || "").trim();
  const captainId = String(body.captainId || "").trim();
  const viceCaptainId = String(body.viceCaptainId || "").trim();
  const playerIds = Array.isArray(body.playerIds)
    ? body.playerIds.map((id: string) => String(id))
    : [];

  if (!tournamentId || !name) {
    return NextResponse.json(
      { error: "tournamentId and name are required." },
      { status: 400 }
    );
  }

  const teamId = `team_${crypto.randomUUID()}`;
  const searchName = normalizeSearchText(`${name} ${shortName}`);
  const searchPrefixes = buildPrefixes(`${name} ${shortName}`);
  const doc = {
    team_id: teamId,
    tournament_id: tournamentId,
    name,
    short_name: shortName || name.slice(0, 3).toUpperCase(),
    captain_id: captainId || null,
    vice_captain_id: viceCaptainId || null,
    player_ids: playerIds,
    search_name: searchName,
    search_prefixes: searchPrefixes,
    created_by: session.sub,
    created_at: new Date(),
  };

  const db = await getDb();
  await db.collection("managed_teams").insertOne(doc);

  return NextResponse.json({ team: doc });
}

export async function PATCH(request: Request) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const teamId = String(body.teamId || "").trim();
  const tournamentId = String(body.tournamentId || "").trim();
  const name = String(body.name || "").trim();
  const shortName = String(body.shortName || "").trim();
  const captainId = String(body.captainId || "").trim();
  const viceCaptainId = String(body.viceCaptainId || "").trim();
  const playerIds = Array.isArray(body.playerIds)
    ? body.playerIds.map((id: string) => String(id))
    : null;

  if (!teamId || !tournamentId) {
    return NextResponse.json(
      { error: "teamId and tournamentId are required." },
      { status: 400 }
    );
  }

  const updates: Record<string, any> = { updated_at: new Date() };
  const nextName = name || null;
  const nextShort = shortName || null;
  if (nextName) updates.name = nextName;
  if (nextShort) updates.short_name = nextShort;
  if (captainId) updates.captain_id = captainId;
  if (viceCaptainId) updates.vice_captain_id = viceCaptainId;
  if (playerIds) updates.player_ids = playerIds;

  const db = await getDb();
  if (nextName || nextShort) {
    const existing = await db
      .collection("managed_teams")
      .findOne({ team_id: teamId, tournament_id: tournamentId }, { projection: { name: 1, short_name: 1 } });
    const combined = `${nextName || existing?.name || ""} ${nextShort || existing?.short_name || ""}`.trim();
    if (combined) {
      updates.search_name = normalizeSearchText(combined);
      updates.search_prefixes = buildPrefixes(combined);
    }
  }
  await db.collection("managed_teams").updateOne(
    { team_id: teamId, tournament_id: tournamentId },
    { $set: updates }
  );

  const team = await db
    .collection("managed_teams")
    .findOne({ team_id: teamId, tournament_id: tournamentId });

  if (!team) {
    return NextResponse.json({ error: "Team not found." }, { status: 404 });
  }

  const { _id, ...payload } = team;
  return NextResponse.json({ team: payload });
}

export async function DELETE(request: Request) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const teamId = searchParams.get("teamId");
  const tournamentId = searchParams.get("tournamentId");
  if (!teamId || !tournamentId) {
    return NextResponse.json(
      { error: "teamId and tournamentId are required." },
      { status: 400 }
    );
  }

  const db = await getDb();
  await db
    .collection("managed_teams")
    .deleteOne({ team_id: teamId, tournament_id: tournamentId });

  return NextResponse.json({ deleted: true });
}
