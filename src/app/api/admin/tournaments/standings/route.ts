import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongo";
import { getAdminSession } from "@/lib/admin-session";

export async function GET(request: Request) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const tournamentId = String(searchParams.get("tournamentId") || "").trim();
  const groupId = String(searchParams.get("groupId") || "").trim();

  if (!tournamentId) {
    return NextResponse.json({ error: "tournamentId is required." }, { status: 400 });
  }

  const db = await getDb();
  const query: Record<string, any> = { tournament_id: tournamentId };
  if (groupId) {
    query.group_id = groupId;
  }
  const standings = await db
    .collection("tournament_standings")
    .find(query)
    .sort({ group_id: 1, rank: 1 })
    .toArray();

  const payload = standings.map((doc) => {
    const { _id, ...rest } = doc;
    return rest;
  });

  return NextResponse.json({ standings: payload });
}
