import { NextResponse } from "next/server";
import crypto from "crypto";
import { getDb } from "@/lib/mongo";
import { getAdminSession } from "@/lib/admin-session";

export async function GET(request: Request) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const tournamentId = searchParams.get("tournamentId");

  if (!tournamentId) {
    return NextResponse.json({ error: "tournamentId is required." }, { status: 400 });
  }

  const db = await getDb();
  const matches = await db
    .collection("managed_matches")
    .find({ tournament_id: tournamentId })
    .sort({ match_date: -1 })
    .toArray();

  const payload = matches.map((doc) => {
    const { _id, ...rest } = doc;
    return rest;
  });

  return NextResponse.json({ matches: payload });
}

export async function POST(request: Request) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const tournamentId = String(body.tournamentId || "").trim();
  const teamAId = String(body.teamAId || "").trim();
  const teamBId = String(body.teamBId || "").trim();
  const hasMatchDate = Object.prototype.hasOwnProperty.call(body, "matchDate");
  const matchDate = hasMatchDate ? String(body.matchDate || "").trim() : "";
  const overs = Number(body.overs || 0);
  const tossWinnerId = String(body.tossWinnerId || "").trim();
  const tossDecision = String(body.tossDecision || "").trim();
  const settings = body.settings && typeof body.settings === "object" ? body.settings : null;
  const groupId = String(body.groupId || "").trim();
  const groupName = String(body.groupName || "").trim();
  const round = String(body.round || "").trim();
  const stage = String(body.stage || "").trim().toUpperCase();
  const venue = String(body.venue || "").trim();
  const countsForStandings =
    body.countsForStandings === undefined ? null : Boolean(body.countsForStandings);
  const sortDate = matchDate ? new Date(matchDate) : null;
  const sortDateValue = sortDate && !Number.isNaN(sortDate.valueOf()) ? sortDate : new Date();

  if (!tournamentId || !teamAId || !teamBId) {
    return NextResponse.json(
      { error: "tournamentId, teamAId, and teamBId are required." },
      { status: 400 }
    );
  }

  const db = await getDb();
  const matchId = `match_${crypto.randomUUID()}`;
  const tournament = await db
    .collection("managed_tournaments")
    .findOne({ tournament_id: tournamentId });
  const defaultOvers = tournament?.overs ? Number(tournament.overs) : null;
  const tournamentFormat = String(tournament?.format || "").toUpperCase();
  const resolvedStage =
    stage ||
    (tournamentFormat === "KNOCKOUT"
      ? "KNOCKOUT"
      : tournamentFormat === "GROUP_KNOCKOUT"
        ? groupId
          ? "GROUP"
          : "KNOCKOUT"
        : groupId
          ? "GROUP"
          : "LEAGUE");
  const resolvedCounts =
    countsForStandings !== null
      ? countsForStandings
      : resolvedStage === "KNOCKOUT"
        ? false
        : true;
  const doc = {
    match_id: matchId,
    tournament_id: tournamentId,
    team_a_id: teamAId,
    team_b_id: teamBId,
    match_date: matchDate || null,
    overs: overs || defaultOvers || null,
    toss_winner_id: tossWinnerId || null,
    toss_decision: tossDecision ? tossDecision.toLowerCase() : null,
    group_id: groupId || null,
    group_name: groupName || null,
    round: round || null,
    stage: resolvedStage,
    venue: venue || null,
    counts_for_standings: resolvedCounts,
    settings: settings
      ? {
          noConsecutiveBowler: Boolean(settings.noConsecutiveBowler),
          countWideAsBall: Boolean(settings.countWideAsBall),
          countNoBallAsBall: Boolean(settings.countNoBallAsBall),
        }
      : {},
    status: "scheduled",
    created_by: session.sub,
    created_at: new Date(),
    updated_at: new Date(),
    sort_date: sortDateValue,
  };

  await db.collection("managed_matches").insertOne(doc);

  return NextResponse.json({ match: doc });
}

export async function PATCH(request: Request) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const matchId = String(body.matchId || "").trim();
  const tournamentId = String(body.tournamentId || "").trim();
  const teamAId = String(body.teamAId || "").trim();
  const teamBId = String(body.teamBId || "").trim();
  const hasMatchDate = Object.prototype.hasOwnProperty.call(body, "matchDate");
  const matchDate = String(body.matchDate || "").trim();
  const overs = body.overs !== undefined ? Number(body.overs) : null;
  const tossWinnerId = String(body.tossWinnerId || "").trim();
  const tossDecision = String(body.tossDecision || "").trim();
  const settings = body.settings && typeof body.settings === "object" ? body.settings : null;
  const groupId = Object.prototype.hasOwnProperty.call(body, "groupId")
    ? String(body.groupId || "").trim()
    : null;
  const groupName = Object.prototype.hasOwnProperty.call(body, "groupName")
    ? String(body.groupName || "").trim()
    : null;
  const round = Object.prototype.hasOwnProperty.call(body, "round")
    ? String(body.round || "").trim()
    : null;
  const stage = Object.prototype.hasOwnProperty.call(body, "stage")
    ? String(body.stage || "").trim().toUpperCase()
    : null;
  const venue = Object.prototype.hasOwnProperty.call(body, "venue")
    ? String(body.venue || "").trim()
    : null;
  const countsForStandings = Object.prototype.hasOwnProperty.call(body, "countsForStandings")
    ? Boolean(body.countsForStandings)
    : null;
  const squadAIds = Array.isArray(body.squadAIds)
    ? Array.from(new Set(body.squadAIds.map((id: string) => String(id).trim()).filter(Boolean)))
    : null;
  const squadBIds = Array.isArray(body.squadBIds)
    ? Array.from(new Set(body.squadBIds.map((id: string) => String(id).trim()).filter(Boolean)))
    : null;

  if (!matchId || !tournamentId) {
    return NextResponse.json(
      { error: "matchId and tournamentId are required." },
      { status: 400 }
    );
  }

  const db = await getDb();
  const updates: Record<string, any> = { updated_at: new Date() };
  if (teamAId) updates.team_a_id = teamAId;
  if (teamBId) updates.team_b_id = teamBId;
  if (hasMatchDate && matchDate) {
    updates.match_date = matchDate;
    const parsed = new Date(matchDate);
    if (!Number.isNaN(parsed.valueOf())) {
      updates.sort_date = parsed;
    }
  }
  if (hasMatchDate && matchDate === "") {
    updates.match_date = null;
  }
  if (overs !== null && !Number.isNaN(overs)) {
    const match = await db
      .collection("managed_matches")
      .findOne({ match_id: matchId, tournament_id: tournamentId });
    if (match?.status && match.status !== "scheduled") {
      return NextResponse.json(
        { error: "Overs can only be changed before match start." },
        { status: 409 }
      );
    }
    updates.overs = overs || null;
  }
  if (groupId !== null) updates.group_id = groupId || null;
  if (groupName !== null) updates.group_name = groupName || null;
  if (round !== null) updates.round = round || null;
  if (stage !== null) updates.stage = stage || null;
  if (venue !== null) updates.venue = venue || null;
  if (countsForStandings !== null) updates.counts_for_standings = countsForStandings;
  if (squadAIds) updates.squad_a_ids = squadAIds;
  if (squadBIds) updates.squad_b_ids = squadBIds;
  if (tossWinnerId) updates.toss_winner_id = tossWinnerId;
  if (tossDecision) updates.toss_decision = tossDecision.toLowerCase();
  if (settings) {
    updates.settings = {
      noConsecutiveBowler: Boolean(settings.noConsecutiveBowler),
      countWideAsBall: Boolean(settings.countWideAsBall),
      countNoBallAsBall: Boolean(settings.countNoBallAsBall),
    };
  }

  await db
    .collection("managed_matches")
    .updateOne({ match_id: matchId, tournament_id: tournamentId }, { $set: updates });

  const match = await db
    .collection("managed_matches")
    .findOne({ match_id: matchId, tournament_id: tournamentId });

  if (!match) {
    return NextResponse.json({ error: "Match not found." }, { status: 404 });
  }

  const { _id, ...payload } = match;
  return NextResponse.json({ match: payload });
}

export async function DELETE(request: Request) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const matchId = searchParams.get("matchId");
  const tournamentId = searchParams.get("tournamentId");
  if (!matchId || !tournamentId) {
    return NextResponse.json(
      { error: "matchId and tournamentId are required." },
      { status: 400 }
    );
  }

  const db = await getDb();
  await db
    .collection("managed_matches")
    .deleteOne({ match_id: matchId, tournament_id: tournamentId });
  await db.collection("live_scores").deleteMany({ match_id: matchId });

  return NextResponse.json({ deleted: true });
}
