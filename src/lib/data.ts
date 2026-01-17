import { cache } from "react";
import { getDb } from "@/lib/mongo";

type MongoDoc = Record<string, any> & { _id?: unknown };

function stripId<T extends MongoDoc | null>(doc: T) {
  if (!doc) return doc;
  const { _id, ...rest } = doc;
  return rest as Omit<T, "_id">;
}

export const getAvailableYears = cache(async () => {
  const db = await getDb();
  const years = await db.collection("years").find({}, { projection: { year: 1 } }).toArray();
  return years.map((item) => Number(item.year)).sort((a, b) => b - a);
});

export const getYearSummaries = cache(async () => {
  const db = await getDb();
  const [yearDocs, aggregates] = await Promise.all([
    db.collection("years").find({}, { projection: { year: 1 } }).toArray(),
    db
      .collection("events")
      .aggregate([
        {
          $project: {
            year: 1,
            type: { $toUpper: "$type" },
            schedule_count: { $ifNull: ["$schedule_count", 0] },
          },
        },
        {
          $group: {
            _id: "$year",
            actEvents: {
              $sum: { $cond: [{ $eq: ["$type", "ACT"] }, 1, 0] },
            },
            abctEvents: {
              $sum: { $cond: [{ $eq: ["$type", "ABCT"] }, 1, 0] },
            },
            actMatches: {
              $sum: { $cond: [{ $eq: ["$type", "ACT"] }, "$schedule_count", 0] },
            },
            abctMatches: {
              $sum: { $cond: [{ $eq: ["$type", "ABCT"] }, "$schedule_count", 0] },
            },
          },
        },
        {
          $project: {
            year: "$_id",
            actEvents: 1,
            abctEvents: 1,
            matches: { $add: ["$actMatches", "$abctMatches"] },
            _id: 0,
          },
        },
      ])
      .toArray(),
  ]);

  const yearSet = new Set<number>();
  for (const doc of yearDocs) {
    const year = Number(doc.year);
    if (Number.isFinite(year)) yearSet.add(year);
  }

  const summaryMap = new Map<
    number,
    { year: number; actEvents: number; abctEvents: number; matches: number }
  >();
  for (const agg of aggregates) {
    const year = Number(agg.year);
    if (!Number.isFinite(year)) continue;
    yearSet.add(year);
    summaryMap.set(year, {
      year,
      actEvents: agg.actEvents || 0,
      abctEvents: agg.abctEvents || 0,
      matches: agg.matches || 0,
    });
  }

  return [...yearSet]
    .sort((a, b) => b - a)
    .map((year) =>
      summaryMap.get(year) || {
        year,
        actEvents: 0,
        abctEvents: 0,
        matches: 0,
      },
    );
});

export const getYearData = cache(async (year: number) => {
  const db = await getDb();
  const eventProjection = {
    event_id: 1,
    event_index: 1,
    year: 1,
    type: 1,
    event_name: 1,
    start_date: 1,
    end_date: 1,
    schedule_count: 1,
    player_count: 1,
    "combined.schedule": 1,
    "combined.leaderboards": 1,
  };
  const [yearMeta, events] = await Promise.all([
    db.collection("years").findOne({ year }),
    db
      .collection("events")
      .find({ year }, { projection: eventProjection })
      .sort({ event_index: 1 })
      .toArray(),
  ]);

  const actEvents: Array<Record<string, any>> = [];
  const abctEvents: Array<Record<string, any>> = [];

  for (const event of events) {
    const clean = stripId(event);
    const type = String(event.type || "").toUpperCase();
    if (type === "ACT") actEvents.push(clean);
    if (type === "ABCT") abctEvents.push(clean);
  }

  return {
    year,
    generated_at: yearMeta?.generated_at || null,
    tournaments: {
      act: { events: actEvents },
      abct: { events: abctEvents },
    },
  };
});

export const getAbctYearSummary = cache(async (year: number) => {
  const db = await getDb();
  const projection: Record<string, number> = { _id: 0 };
  projection[`data.abct_year_summary.${year}`] = 1;
  const doc = await db
    .collection("meta")
    .findOne({ key: "player_history" }, { projection });
  return doc?.data?.abct_year_summary?.[year] || null;
});

export const getPlayerHistory = cache(async () => {
  const db = await getDb();
  const doc = await db.collection("meta").findOne({ key: "player_history" });
  if (!doc?.data) {
    throw new Error("player_history not found in MongoDB. Run the seed script.");
  }
  return doc.data;
});

export const getPlayerCount = cache(async () => {
  const db = await getDb();
  const [meta, customCount] = await Promise.all([
    db.collection("meta").findOne({ key: "player_history" }),
    db.collection("custom_players").countDocuments(),
  ]);
  const players = meta?.data?.players || {};
  const globalCount = Object.keys(players).length;
  return globalCount + (customCount || 0);
});

export const getGlobalPlayers = cache(async () => {
  const db = await getDb();
  const doc = await db.collection("meta").findOne({ key: "global_player_database" });
  if (!doc?.data) {
    throw new Error("global_player_database not found in MongoDB. Run the seed script.");
  }
  return doc.data;
});

export const getYearSummary = cache(async (year: number) => {
  const db = await getDb();
  const events = await db
    .collection("events")
    .find({ year }, { projection: { type: 1, schedule_count: 1 } })
    .toArray();

  const sumMatches = (type: string) =>
    events
      .filter((event) => String(event.type).toUpperCase() === type)
      .reduce((acc, event) => acc + (event.schedule_count || 0), 0);

  const actMatches = sumMatches("ACT");
  const abctMatches = sumMatches("ABCT");

  return {
    year,
    actEvents: events.filter((event) => String(event.type).toUpperCase() === "ACT").length,
    abctEvents: events.filter((event) => String(event.type).toUpperCase() === "ABCT").length,
    matches: actMatches + abctMatches,
  };
});

export const getLatestMatch = async () => {
  const matches = await getRecentMatches(1);
  return matches[0] || null;
};

export const getRecentMatches = cache(async (limit = 5) => {
  const db = await getDb();
  const [archiveDocs, managedDocs] = await Promise.all([
    db
      .collection("matches")
      .find(
        {
          $or: [
            { sort_date: { $exists: true, $ne: null } },
            { "schedule.match_start_time": { $exists: true, $ne: null } },
            { "schedule.created_date": { $exists: true, $ne: null } },
            { "schedule.updated_date": { $exists: true, $ne: null } },
          ],
        },
        {
          projection: {
            sort_date: 1,
            year: 1,
            schedule: 1,
          },
        },
      )
      .sort({
        sort_date: -1,
        "schedule.match_start_time": -1,
        "schedule.created_date": -1,
        "schedule.updated_date": -1,
      })
      .limit(limit)
      .toArray(),
    db
      .collection("managed_matches")
      .find({ status: "completed" })
      .sort({ sort_date: -1 })
      .limit(limit)
      .toArray(),
  ]);

  const tournamentIds = managedDocs.map((doc) => doc.tournament_id).filter(Boolean);
  const teamIds = managedDocs
    .flatMap((doc) => [doc.team_a_id, doc.team_b_id])
    .filter(Boolean);

  const [tournaments, teams] = await Promise.all([
    tournamentIds.length
      ? db
        .collection("managed_tournaments")
        .find({ tournament_id: { $in: tournamentIds } })
        .toArray()
      : [],
    teamIds.length
      ? db
        .collection("managed_teams")
        .find({ team_id: { $in: teamIds } })
        .toArray()
      : [],
  ]);

  const tournamentMap = new Map(
    tournaments.map((doc: any) => [doc.tournament_id, doc])
  );
  const teamMap = new Map(teams.map((doc: any) => [doc.team_id, doc]));

  const managedMatches = managedDocs.map((doc) => {
    const tournament = tournamentMap.get(doc.tournament_id);
    const teamA = teamMap.get(doc.team_a_id);
    const teamB = teamMap.get(doc.team_b_id);
    const sortDate = doc.sort_date || doc.updated_at || doc.created_at || null;
    const year =
      doc.year ||
      tournament?.year ||
      (sortDate ? new Date(sortDate).getFullYear() : null);

    return {
      sort_date: sortDate,
      year,
      match: {
        match_id: doc.match_id,
        tournament_id: doc.tournament_id,
        team_a: teamA?.name || "Team A",
        team_b: teamB?.name || "Team B",
        team_a_summary: doc.team_a_summary || "",
        team_b_summary: doc.team_b_summary || "",
        match_summary: doc.result_summary ? { summary: doc.result_summary } : null,
        match_result: doc.result_summary || "",
        match_start_time: doc.match_date || sortDate || null,
        tournament_name: tournament?.name || "",
        team_a_logo: doc.team_a_logo || teamA?.logo || "",
        team_b_logo: doc.team_b_logo || teamB?.logo || "",
      },
    };
  });

  const archiveMatches = archiveDocs.map((doc) => ({
    sort_date:
      doc.sort_date ||
      doc.schedule?.match_start_time ||
      doc.schedule?.created_date ||
      doc.schedule?.updated_date ||
      null,
    year:
      doc.year ||
      (doc.schedule?.match_start_time
        ? new Date(doc.schedule.match_start_time).getFullYear()
        : null),
    match: doc.schedule || {},
  }));

  const combined = [...managedMatches, ...archiveMatches]
    .filter((entry) => entry.match)
    .sort((a, b) => {
      const aTime = a.sort_date ? new Date(a.sort_date).getTime() : 0;
      const bTime = b.sort_date ? new Date(b.sort_date).getTime() : 0;
      return bTime - aTime;
    })
    .slice(0, limit)
    .map(({ year, match }) => ({ year, match }));

  return combined;
});

export const getMatchContext = cache(async (tournamentId: string, matchId: string) => {
  const db = await getDb();
  const history = await getPlayerHistory();
  const tournament = history.tournament_index?.[tournamentId];

  const matchDoc = await db.collection("matches").findOne({
    tournament_id: String(tournamentId),
    match_id: String(matchId),
  });

  if (!matchDoc) return null;

  const event = matchDoc.event_id
    ? await db.collection("events").findOne({ event_id: matchDoc.event_id })
    : null;

  return {
    year: matchDoc.year,
    event: stripId(event),
    matchEntry: matchDoc.match_data,
    scheduleEntry: matchDoc.schedule,
    tournament,
  };
});
