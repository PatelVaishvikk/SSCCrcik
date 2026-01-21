import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongo";
import { getAdminSession } from "@/lib/admin-session";
import { getPlayersPerSide } from "@/lib/scoring/v2/engine";
import { getMatchConfig } from "@/lib/scoring/v2/match";

type InningsState = {
  batting_team_id: string;
  bowling_team_id: string;
  runs: number;
  wickets: number;
  balls: number;
  overs?: number | null;
  striker_id: string | null;
  non_striker_id: string | null;
  bowler_id: string | null;
  events: Array<Record<string, any>>;
};

function swapStrike(striker: string | null, nonStriker: string | null) {
  return { striker: nonStriker, nonStriker: striker };
}

export async function POST(request: Request) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const action = String(body.action || "").trim();
  const matchId = String(body.matchId || "").trim();

  if (!matchId || !action) {
    return NextResponse.json({ error: "action and matchId are required." }, { status: 400 });
  }

  const db = await getDb();
  const liveCol = db.collection("live_scores");
  const matchesCol = db.collection("managed_matches");

  if (action === "start" || action === "switchInnings") {
    const tournamentId = String(body.tournamentId || "").trim();
    const battingTeamId = String(body.battingTeamId || "").trim();
    const bowlingTeamId = String(body.bowlingTeamId || "").trim();
    const strikerId = String(body.strikerId || "").trim();
    const nonStrikerId = String(body.nonStrikerId || "").trim();
    const bowlerId = String(body.bowlerId || "").trim();
    const overs = body.overs ? Number(body.overs) : null;

    if (!tournamentId || !battingTeamId || !bowlingTeamId || !strikerId || !nonStrikerId) {
      return NextResponse.json(
        { error: "Missing batting/bowling teams or batters." },
        { status: 400 }
      );
    }

    const newInnings: InningsState = {
      batting_team_id: battingTeamId,
      bowling_team_id: bowlingTeamId,
      runs: 0,
      wickets: 0,
      balls: 0,
      overs,
      striker_id: strikerId,
      non_striker_id: nonStrikerId,
      bowler_id: bowlerId || null,
      events: [],
    };

    const existing = await liveCol.findOne({ match_id: matchId });

    if (existing && action === "switchInnings") {
      const innings = Array.isArray(existing.innings) ? existing.innings : [];
      const updated = {
        ...existing,
        status: "live",
        innings: [...innings, newInnings],
        current_innings: innings.length,
        last_updated: new Date(),
      };

      await liveCol.updateOne({ match_id: matchId }, { $set: updated }, { upsert: true });
      await matchesCol.updateOne(
        { match_id: matchId },
        { $set: { status: "live", updated_at: new Date() } }
      );

      const { _id, ...payload } = updated;
      return NextResponse.json({ live: payload });
    }

    const liveDoc = {
      match_id: matchId,
      tournament_id: tournamentId,
      status: "live",
      overs,
      innings: [newInnings],
      current_innings: 0,
      last_updated: new Date(),
      updated_at: new Date(),
    };

    await liveCol.updateOne({ match_id: matchId }, { $set: liveDoc }, { upsert: true });
    await matchesCol.updateOne(
      { match_id: matchId },
      { $set: { status: "live", updated_at: new Date() } }
    );

    return NextResponse.json({ live: liveDoc });
  }

  if (action === "ball") {
    const runs = Number(body.runs || 0);
    const legalBall = body.legalBall !== false;
    const wicket = Boolean(body.wicket);
    const nextStrikerId = String(body.nextStrikerId || "").trim();
    const extraType = String(body.extraType || "").trim().toLowerCase();

    const liveDoc = await liveCol.findOne({ match_id: matchId });
    if (!liveDoc) {
      return NextResponse.json({ error: "Live match not started." }, { status: 404 });
    }

    const inningsIndex = Number(liveDoc.current_innings || 0);
    const innings = Array.isArray(liveDoc.innings) ? [...liveDoc.innings] : [];
    const current = innings[inningsIndex] as InningsState | undefined;

    if (!current) {
      return NextResponse.json({ error: "Invalid innings state." }, { status: 400 });
    }

    let striker = current.striker_id;
    let nonStriker = current.non_striker_id;
    const bowler = current.bowler_id;

    const event = {
      runs,
      legalBall,
      wicket,
      extra_type: legalBall ? "" : extraType || "extra",
      striker_id: striker,
      out_batter_id: wicket ? striker : "",
      non_striker_id: nonStriker,
      bowler_id: bowler,
      timestamp: new Date(),
    };

    const nextBalls = current.balls + (legalBall ? 1 : 0);
    const nextRuns = current.runs + runs;
    const nextWickets = current.wickets + (wicket ? 1 : 0);

    if (wicket) {
      striker = nextStrikerId ? nextStrikerId : null;
    }

    let swap = false;
    if (legalBall && runs % 2 === 1) swap = true;
    if (legalBall && nextBalls % 6 === 0) swap = !swap;

    if (swap && striker && nonStriker) {
      const swapped = swapStrike(striker, nonStriker);
      striker = swapped.striker;
      nonStriker = swapped.nonStriker;
    }

    const updated: InningsState = {
      ...current,
      runs: nextRuns,
      wickets: nextWickets,
      balls: nextBalls,
      striker_id: striker,
      non_striker_id: nonStriker,
      events: [...current.events, event].slice(-240),
    };

    innings[inningsIndex] = updated;

    const updatedDoc = {
      ...liveDoc,
      innings,
      last_updated: new Date(),
    };

    await liveCol.updateOne({ match_id: matchId }, { $set: updatedDoc });

    const { _id, ...payload } = updatedDoc;
    return NextResponse.json({ live: payload, needsBatsman: wicket && !nextStrikerId });
  }

  if (action === "undo") {
    const liveDoc = await liveCol.findOne({ match_id: matchId });
    if (!liveDoc) {
      return NextResponse.json({ error: "Live match not started." }, { status: 404 });
    }

    const inningsIndex = Number(liveDoc.current_innings || 0);
    const innings = Array.isArray(liveDoc.innings) ? [...liveDoc.innings] : [];
    const current = innings[inningsIndex] as InningsState | undefined;

    if (!current || !current.events?.length) {
      return NextResponse.json({ error: "No balls to undo." }, { status: 400 });
    }

    const lastEvent = current.events[current.events.length - 1];
    const legalBall = lastEvent.legalBall !== false;
    const updated: InningsState = {
      ...current,
      runs: Math.max(0, current.runs - Number(lastEvent.runs || 0)),
      wickets: Math.max(0, current.wickets - (lastEvent.wicket ? 1 : 0)),
      balls: Math.max(0, current.balls - (legalBall ? 1 : 0)),
      striker_id: lastEvent.striker_id || current.striker_id,
      non_striker_id: lastEvent.non_striker_id || current.non_striker_id,
      bowler_id: lastEvent.bowler_id || current.bowler_id,
      events: current.events.slice(0, -1),
    };

    innings[inningsIndex] = updated;

    const updatedDoc = {
      ...liveDoc,
      innings,
      last_updated: new Date(),
    };

    await liveCol.updateOne({ match_id: matchId }, { $set: updatedDoc });

    const { _id, ...payload } = updatedDoc;
    return NextResponse.json({ live: payload });
  }

  if (action === "setPlayers") {
    const strikerId = String(body.strikerId || "").trim();
    const nonStrikerId = String(body.nonStrikerId || "").trim();
    const bowlerId = String(body.bowlerId || "").trim();

    const liveDoc = await liveCol.findOne({ match_id: matchId });
    if (!liveDoc) {
      return NextResponse.json({ error: "Live match not started." }, { status: 404 });
    }

    const inningsIndex = Number(liveDoc.current_innings || 0);
    const innings = Array.isArray(liveDoc.innings) ? [...liveDoc.innings] : [];
    const current = innings[inningsIndex] as InningsState | undefined;

    if (!current) {
      return NextResponse.json({ error: "Invalid innings state." }, { status: 400 });
    }

    innings[inningsIndex] = {
      ...current,
      striker_id: strikerId || current.striker_id,
      non_striker_id: nonStrikerId || current.non_striker_id,
      bowler_id: bowlerId || current.bowler_id,
    };

    const updatedDoc = {
      ...liveDoc,
      innings,
      last_updated: new Date(),
    };

    await liveCol.updateOne({ match_id: matchId }, { $set: updatedDoc });

    const { _id, ...payload } = updatedDoc;
    return NextResponse.json({ live: payload });
  }

  if (action === "end") {
    await liveCol.updateOne(
      { match_id: matchId },
      { $set: { status: "completed", last_updated: new Date() } }
    );
    const liveDoc = await liveCol.findOne({ match_id: matchId });

    if (liveDoc) {
      const matchDoc = await matchesCol.findOne({ match_id: matchId });
      const innings = Array.isArray(liveDoc.innings) ? liveDoc.innings : [];
      const teamTotals = new Map<string, { runs: number; wickets: number; balls: number }>();

      innings.forEach((inning: InningsState) => {
        const teamId = String(inning.batting_team_id || "");
        if (!teamId) return;
        const current = teamTotals.get(teamId) || { runs: 0, wickets: 0, balls: 0 };
        teamTotals.set(teamId, {
          runs: current.runs + (inning.runs || 0),
          wickets: current.wickets + (inning.wickets || 0),
          balls: current.balls + (inning.balls || 0),
        });
      });

      if (matchDoc) {
        const matchConfig = getMatchConfig(matchDoc as any);
        const teamIds = [matchDoc.team_a_id, matchDoc.team_b_id].filter(Boolean);
        const teams = await db
          .collection("managed_teams")
          .find({ team_id: { $in: teamIds } })
          .toArray();
        const teamMap = new Map(teams.map((team: any) => [team.team_id, team]));

        const teamAScore = teamTotals.get(matchDoc.team_a_id) || {
          runs: 0,
          wickets: 0,
          balls: 0,
        };
        const teamBScore = teamTotals.get(matchDoc.team_b_id) || {
          runs: 0,
          wickets: 0,
          balls: 0,
        };

        let winnerTeamId: string | null = null;
        let resultSummary = "Match completed";

        if (innings.length >= 2) {
          const first = innings[0];
          const second = innings[1];
          if (second.runs > first.runs) {
            winnerTeamId = String(second.batting_team_id || "") || null;
            const playersPerSide = getPlayersPerSide(matchConfig, second.batting_team_id);
            const wicketsLimit = Math.max(playersPerSide - 1, 0);
            const wicketsLeft = Math.max(0, wicketsLimit - (second.wickets || 0));
            const winnerName =
              teamMap.get(winnerTeamId || "")?.name || "Team";
            resultSummary = `${winnerName} won by ${wicketsLeft} wickets`;
          } else if (first.runs > second.runs) {
            winnerTeamId = String(first.batting_team_id || "") || null;
            const margin = Math.max(0, (first.runs || 0) - (second.runs || 0));
            const winnerName =
              teamMap.get(winnerTeamId || "")?.name || "Team";
            resultSummary = `${winnerName} won by ${margin} runs`;
          } else {
            resultSummary = "Match tied";
          }
        } else if (teamAScore.runs !== teamBScore.runs) {
          winnerTeamId =
            teamAScore.runs > teamBScore.runs
              ? matchDoc.team_a_id
              : matchDoc.team_b_id;
          const winnerName =
            teamMap.get(winnerTeamId || "")?.name || "Team";
          resultSummary = `${winnerName} won`;
        }

        await matchesCol.updateOne(
          { match_id: matchId },
          {
            $set: {
              status: "completed",
              updated_at: new Date(),
              team_a_summary: `${teamAScore.runs}/${teamAScore.wickets}`,
              team_b_summary: `${teamBScore.runs}/${teamBScore.wickets}`,
              team_a_balls: teamAScore.balls,
              team_b_balls: teamBScore.balls,
              result_summary: resultSummary,
              winner_team_id: winnerTeamId,
            },
          }
        );
      } else {
        await matchesCol.updateOne(
          { match_id: matchId },
          { $set: { status: "completed", updated_at: new Date() } }
        );
      }
    } else {
      await matchesCol.updateOne(
        { match_id: matchId },
        { $set: { status: "completed", updated_at: new Date() } }
      );
    }

    const { _id, ...payload } = liveDoc || {};
    return NextResponse.json({ live: payload });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}

export async function GET(request: Request) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const matchId = searchParams.get("matchId");
  if (!matchId) {
    return NextResponse.json({ error: "matchId is required." }, { status: 400 });
  }

  const db = await getDb();
  const liveDoc = await db.collection("live_scores").findOne({ match_id: matchId });
  if (!liveDoc) {
    return NextResponse.json({ live: null });
  }

  const { _id, ...payload } = liveDoc;
  return NextResponse.json({ live: payload });
}
