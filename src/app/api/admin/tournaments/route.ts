import { NextResponse } from "next/server";
import crypto from "crypto";
import { getDb } from "@/lib/mongo";
import { getAdminSession } from "@/lib/admin-session";
import { buildPrefixes, normalizeSearchText } from "@/lib/search";

function toNumber(value: unknown, fallback: number) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export async function GET() {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  const tournaments = await db
    .collection("managed_tournaments")
    .find({})
    .sort({ created_at: -1 })
    .toArray();

  const payload = tournaments.map((doc) => {
    const { _id, ...rest } = doc;
    return rest;
  });

  return NextResponse.json({ tournaments: payload });
}

export async function POST(request: Request) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  const type = String(body.type || "").trim().toUpperCase();
  const format = String(body.format || "LEAGUE").trim().toUpperCase();
  const year = Number(body.year);
  const startDate = String(body.startDate || "").trim();
  const endDate = String(body.endDate || "").trim();
  const overs = body.overs !== undefined ? Number(body.overs) : null;
  const pointsRules = body.pointsRules && typeof body.pointsRules === "object" ? body.pointsRules : {};
  const bonusRules = body.bonusRules && typeof body.bonusRules === "object" ? body.bonusRules : {};
  const tieBreakers = Array.isArray(body.tieBreakers) ? body.tieBreakers : null;

  if (!name || !type || !year) {
    return NextResponse.json({ error: "Name, type, and year are required." }, { status: 400 });
  }

  const searchName = normalizeSearchText(name);
  const searchPrefixes = buildPrefixes(name);

  const tournamentId = `t_${crypto.randomUUID()}`;
  const doc = {
    tournament_id: tournamentId,
    name,
    type,
    format: format || "LEAGUE",
    year,
    start_date: startDate || null,
    end_date: endDate || null,
    overs: overs && Number.isFinite(overs) ? overs : null,
    points_rules: {
      win: toNumber(pointsRules.win ?? 2, 2),
      tie: toNumber(pointsRules.tie ?? 1, 1),
      noResult: toNumber(pointsRules.noResult ?? pointsRules.no_result ?? 1, 1),
      loss: toNumber(pointsRules.loss ?? 0, 0),
      allOutCountsFullOvers: Boolean(pointsRules.allOutCountsFullOvers),
    },
    bonus_rules: {
      enabled: Boolean(bonusRules.enabled),
      winBonus: toNumber(bonusRules.winBonus ?? 1, 1),
      maxBonus: toNumber(bonusRules.maxBonus ?? 1, 1),
      winMarginRuns: bonusRules.winMarginRuns ? toNumber(bonusRules.winMarginRuns, 0) : null,
      winMarginWickets: bonusRules.winMarginWickets ? toNumber(bonusRules.winMarginWickets, 0) : null,
      chaseWithinOvers: bonusRules.chaseWithinOvers ? toNumber(bonusRules.chaseWithinOvers, 0) : null,
    },
    search_name: searchName,
    search_prefixes: searchPrefixes,
    tie_breakers: tieBreakers && tieBreakers.length ? tieBreakers : ["POINTS", "NRR", "WINS"],
    status: "upcoming",
    created_by: session.sub,
    created_at: new Date(),
  };

  const db = await getDb();
  await db.collection("managed_tournaments").insertOne(doc);

  return NextResponse.json({ tournament: doc });
}

export async function PATCH(request: Request) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const tournamentId = String(body.tournamentId || "").trim();
  const name = String(body.name || "").trim();
  const type = String(body.type || "").trim().toUpperCase();
  const format = Object.prototype.hasOwnProperty.call(body, "format")
    ? String(body.format || "").trim().toUpperCase()
    : null;
  const year = body.year ? Number(body.year) : null;
  const startDate = Object.prototype.hasOwnProperty.call(body, "startDate")
    ? String(body.startDate || "").trim()
    : null;
  const endDate = Object.prototype.hasOwnProperty.call(body, "endDate")
    ? String(body.endDate || "").trim()
    : null;
  const hasOvers = Object.prototype.hasOwnProperty.call(body, "overs");
  const overs = hasOvers ? Number(body.overs) : null;
  const pointsRules = Object.prototype.hasOwnProperty.call(body, "pointsRules")
    ? body.pointsRules
    : null;
  const bonusRules = Object.prototype.hasOwnProperty.call(body, "bonusRules")
    ? body.bonusRules
    : null;
  const tieBreakers = Object.prototype.hasOwnProperty.call(body, "tieBreakers")
    ? body.tieBreakers
    : null;

  if (!tournamentId) {
    return NextResponse.json({ error: "tournamentId is required." }, { status: 400 });
  }

  const updates: Record<string, any> = { updated_at: new Date() };
  if (name) {
    updates.name = name;
    updates.search_name = normalizeSearchText(name);
    updates.search_prefixes = buildPrefixes(name);
  }
  if (type) updates.type = type;
  if (format !== null) updates.format = format || "LEAGUE";
  if (year) updates.year = year;
  if (startDate !== null) updates.start_date = startDate || null;
  if (endDate !== null) updates.end_date = endDate || null;
  if (hasOvers) updates.overs = Number.isFinite(overs) && overs ? overs : null;
  if (pointsRules && typeof pointsRules === "object") {
    updates.points_rules = {
      win: toNumber(pointsRules.win ?? 2, 2),
      tie: toNumber(pointsRules.tie ?? 1, 1),
      noResult: toNumber(pointsRules.noResult ?? pointsRules.no_result ?? 1, 1),
      loss: toNumber(pointsRules.loss ?? 0, 0),
      allOutCountsFullOvers: Boolean(pointsRules.allOutCountsFullOvers),
    };
  }
  if (bonusRules && typeof bonusRules === "object") {
    updates.bonus_rules = {
      enabled: Boolean(bonusRules.enabled),
      winBonus: toNumber(bonusRules.winBonus ?? 1, 1),
      maxBonus: toNumber(bonusRules.maxBonus ?? 1, 1),
      winMarginRuns: bonusRules.winMarginRuns ? toNumber(bonusRules.winMarginRuns, 0) : null,
      winMarginWickets: bonusRules.winMarginWickets ? toNumber(bonusRules.winMarginWickets, 0) : null,
      chaseWithinOvers: bonusRules.chaseWithinOvers ? toNumber(bonusRules.chaseWithinOvers, 0) : null,
    };
  }
  if (Array.isArray(tieBreakers)) {
    updates.tie_breakers = tieBreakers;
  }

  const db = await getDb();
  await db
    .collection("managed_tournaments")
    .updateOne({ tournament_id: tournamentId }, { $set: updates });

  const tournament = await db
    .collection("managed_tournaments")
    .findOne({ tournament_id: tournamentId });
  if (!tournament) {
    return NextResponse.json({ error: "Tournament not found." }, { status: 404 });
  }

  const { _id, ...payload } = tournament;
  return NextResponse.json({ tournament: payload });
}

export async function DELETE(request: Request) {
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
    .toArray();
  const matchIds = matches.map((match: any) => match.match_id).filter(Boolean);

  await Promise.all([
    db.collection("managed_matches").deleteMany({ tournament_id: tournamentId }),
    db.collection("managed_teams").deleteMany({ tournament_id: tournamentId }),
    matchIds.length
      ? db.collection("live_scores").deleteMany({ match_id: { $in: matchIds } })
      : Promise.resolve(),
  ]);

  await db.collection("managed_tournaments").deleteOne({ tournament_id: tournamentId });

  return NextResponse.json({ deleted: true });
}
