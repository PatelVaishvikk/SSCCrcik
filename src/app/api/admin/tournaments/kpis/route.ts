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
  if (!tournamentId) {
    return NextResponse.json({ error: "tournamentId is required." }, { status: 400 });
  }

  const db = await getDb();

  const [teamsCount, matches, topStanding, latestStanding] = await Promise.all([
    db.collection("managed_teams").countDocuments({ tournament_id: tournamentId }),
    db
      .collection("managed_matches")
      .find({ tournament_id: tournamentId })
      .project({ status: 1 })
      .toArray(),
    db
      .collection("tournament_standings")
      .find({ tournament_id: tournamentId })
      .sort({ points: -1, nrr: -1, won: -1 })
      .limit(1)
      .toArray(),
    db
      .collection("tournament_standings")
      .find({ tournament_id: tournamentId })
      .sort({ updated_at: -1 })
      .limit(1)
      .toArray(),
  ]);

  const totals = matches.reduce(
    (acc, match: any) => {
      const status = String(match.status || "").toLowerCase();
      acc.total += 1;
      if (status === "completed") acc.completed += 1;
      else if (status === "live") acc.live += 1;
      else acc.upcoming += 1;
      return acc;
    },
    { total: 0, completed: 0, live: 0, upcoming: 0 }
  );

  const leader = topStanding?.[0]
    ? {
        team_id: topStanding[0].team_id,
        points: topStanding[0].points,
        nrr: topStanding[0].nrr,
        played: topStanding[0].played,
        rank: topStanding[0].rank,
      }
    : null;

  return NextResponse.json({
    kpis: {
      teams: teamsCount,
      matches_total: totals.total,
      matches_completed: totals.completed,
      matches_live: totals.live,
      matches_upcoming: totals.upcoming,
      standings_updated_at: latestStanding?.[0]?.updated_at || null,
      leader,
    },
  });
}
