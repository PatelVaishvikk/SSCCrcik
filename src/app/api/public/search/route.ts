import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongo";
import {
  MAX_PREFIX_LENGTH,
  buildPrefixQuery,
  ensureSearchIndexes,
  normalizeSearchText,
  scoreMatch,
  tokenizeSearchText,
} from "@/lib/search";
import { getCached, setCached } from "@/lib/hot-cache";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 6;
const MAX_LIMIT = 20;
const CACHE_TTL_MS = 15_000;

const clampTokens = (tokens: string[]) =>
  tokens.map((token) => token.slice(0, MAX_PREFIX_LENGTH)).filter(Boolean);

type PlayerResult = {
  id: string;
  name: string;
  city: string;
  role: string;
  photo: string;
  tournaments: number;
  source: string;
};

type TeamResult = {
  id: string;
  name: string;
  shortName: string;
  tournamentId: string;
  tournamentName: string;
  tournamentYear: number | null;
  tournamentFormat: string;
};

type TournamentResult = {
  id: string;
  name: string;
  year: number | null;
  format: string;
  status: string;
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const queryRaw = String(searchParams.get("q") || "").trim();
  const cityRaw = String(searchParams.get("city") || "").trim();
  const seasonRaw = String(searchParams.get("season") || "").trim();
  const formatRaw = String(searchParams.get("format") || "").trim();
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(searchParams.get("limit") || DEFAULT_LIMIT))
  );

  const query = normalizeSearchText(queryRaw);
  const city = normalizeSearchText(cityRaw);
  const tokens = clampTokens(tokenizeSearchText(query));
  const cityTokens = clampTokens(tokenizeSearchText(city));
  const season = Number(seasonRaw);
  const format = formatRaw ? formatRaw.toUpperCase() : "";

  if (!tokens.length && !cityTokens.length && !seasonRaw && !format) {
    return NextResponse.json({
      query: queryRaw,
      results: { players: [], teams: [], tournaments: [] },
      totals: { players: 0, teams: 0, tournaments: 0 },
    });
  }

  const cacheKey = `search:${query}:${city}:${seasonRaw}:${format}:${limit}`;
  const cached = getCached<{
    query: string;
    results: { players: PlayerResult[]; teams: TeamResult[]; tournaments: TournamentResult[] };
    totals: { players: number; teams: number; tournaments: number };
  }>(cacheKey);
  if (cached) {
    return NextResponse.json(cached, {
      headers: { "Cache-Control": "public, max-age=15" },
    });
  }

  const db = await getDb();
  await ensureSearchIndexes(db);

  const prefixQuery = buildPrefixQuery(tokens);
  const cityQuery = buildPrefixQuery(cityTokens);

  const playerFilter: Record<string, any> = {};
  if (prefixQuery) playerFilter.search_prefixes = prefixQuery;
  if (cityQuery) playerFilter.city_prefixes = cityQuery;

  const teamFilter: Record<string, any> = {};
  if (prefixQuery) teamFilter.search_prefixes = prefixQuery;

  const tournamentFilter: Record<string, any> = {};
  if (prefixQuery) tournamentFilter.search_prefixes = prefixQuery;
  if (Number.isFinite(season) && season > 0) tournamentFilter.year = season;
  if (format) tournamentFilter.format = format;

  const fetchLimit = Math.min(60, Math.max(limit * 5, limit));

  let teamTournamentIds: string[] | null = null;
  let teamTournamentDocs: any[] = [];
  if ((Number.isFinite(season) && season > 0) || format) {
    const teamTournamentFilter: Record<string, any> = {};
    if (Number.isFinite(season) && season > 0) teamTournamentFilter.year = season;
    if (format) teamTournamentFilter.format = format;
    teamTournamentDocs = await db
      .collection("managed_tournaments")
      .find(teamTournamentFilter, {
        projection: { tournament_id: 1, name: 1, year: 1, format: 1 },
      })
      .toArray();
    teamTournamentIds = teamTournamentDocs
      .map((doc: any) => doc.tournament_id)
      .filter(Boolean);
    if (teamTournamentIds.length) {
      teamFilter.tournament_id = { $in: teamTournamentIds };
    }
  }

  const shouldSearchPlayers = Boolean(prefixQuery || cityQuery);
  const shouldSearchTeams = Boolean(prefixQuery || teamTournamentIds !== null);
  const shouldSearchTournaments = Boolean(
    prefixQuery || (Number.isFinite(season) && season > 0) || format
  );

  const teamPromise =
    shouldSearchTeams && teamTournamentIds && !teamTournamentIds.length
      ? Promise.resolve([])
      : shouldSearchTeams
        ? db
          .collection("managed_teams")
          .find(teamFilter, {
            projection: {
              team_id: 1,
              name: 1,
              short_name: 1,
              tournament_id: 1,
              search_name: 1,
            },
          })
          .limit(fetchLimit)
          .toArray()
        : Promise.resolve([]);

  const playerPromise = shouldSearchPlayers
    ? db
      .collection("search_players")
      .find(playerFilter, {
        projection: {
          player_id: 1,
          name: 1,
          city: 1,
          role: 1,
          photo: 1,
          tournaments: 1,
          source: 1,
          search_name: 1,
        },
      })
      .limit(fetchLimit)
      .toArray()
    : Promise.resolve([]);

  const tournamentPromise = shouldSearchTournaments
    ? db
      .collection("managed_tournaments")
      .find(tournamentFilter, {
        projection: {
          tournament_id: 1,
          name: 1,
          year: 1,
          format: 1,
          status: 1,
          search_name: 1,
        },
      })
      .limit(fetchLimit)
      .toArray()
    : Promise.resolve([]);

  const eventPromise = shouldSearchTournaments
    ? db
      .collection("events")
      .find(tournamentFilter, {
        projection: {
          event_id: 1,
          event_name: 1,
          year: 1,
          type: 1,
          search_name: 1,
        },
      })
      .limit(fetchLimit)
      .toArray()
    : Promise.resolve([]);

  const [playerDocs, teamDocs, tournamentDocs, eventDocs] = await Promise.all([
    playerPromise,
    teamPromise,
    tournamentPromise,
    eventPromise,
  ]);

  const mappedTournamentIds = Array.from(
    new Set(teamDocs.map((doc: any) => doc.tournament_id).filter(Boolean))
  );
  const teamTournaments =
    teamTournamentIds !== null
      ? teamTournamentDocs
      : mappedTournamentIds.length
        ? await db
          .collection("managed_tournaments")
          .find(
            { tournament_id: { $in: mappedTournamentIds } },
            { projection: { tournament_id: 1, name: 1, year: 1, format: 1 } }
          )
          .toArray()
        : [];
  const tournamentMap = new Map(
    teamTournaments.map((doc: any) => [doc.tournament_id, doc])
  );

  const players = playerDocs
    .map((doc: any) => {
      const searchName = doc.search_name || normalizeSearchText(doc.name || "");
      const score = scoreMatch(searchName, query);
      return {
        id: String(doc.player_id),
        name: doc.name || "Unknown",
        city: doc.city || "",
        role: doc.role || "",
        photo: doc.photo || "",
        tournaments: Number(doc.tournaments || 0),
        source: doc.source || "global",
        score,
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.tournaments !== a.tournaments) return b.tournaments - a.tournaments;
      return a.name.localeCompare(b.name);
    })
    .slice(0, limit)
    .map(({ score, ...rest }) => rest);

  const teams = teamDocs
    .map((doc: any) => {
      const tournament = tournamentMap.get(doc.tournament_id);
      const searchName = doc.search_name || normalizeSearchText(doc.name || "");
      const score = scoreMatch(searchName, query);
      return {
        id: String(doc.team_id),
        name: doc.name || "Team",
        shortName: doc.short_name || "",
        tournamentId: doc.tournament_id || "",
        tournamentName: tournament?.name || "",
        tournamentYear: tournament?.year ?? null,
        tournamentFormat: tournament?.format || "",
        score,
      };
    })
    .filter((team) => {
      if (Number.isFinite(season) && season > 0) {
        if (team.tournamentYear !== season) return false;
      }
      if (format && team.tournamentFormat !== format) return false;
      return true;
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if ((b.tournamentYear || 0) !== (a.tournamentYear || 0)) {
        return (b.tournamentYear || 0) - (a.tournamentYear || 0);
      }
      return a.name.localeCompare(b.name);
    })
    .slice(0, limit)
    .map(({ score, ...rest }) => rest);

  const tournaments = tournamentDocs
    .map((doc: any) => {
      const searchName = doc.search_name || normalizeSearchText(doc.name || "");
      const score = scoreMatch(searchName, query);
      return {
        id: String(doc.tournament_id),
        name: doc.name || "Tournament",
        year: doc.year ?? null,
        format: doc.format || "",
        status: doc.status || "",
        score,
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if ((b.year || 0) !== (a.year || 0)) return (b.year || 0) - (a.year || 0);
      return a.name.localeCompare(b.name);
    })
    .slice(0, limit)
    .slice(0, limit);

  const archiveTournaments = eventDocs
    .map((doc: any) => {
      const searchName = doc.search_name || normalizeSearchText(doc.event_name || "");
      const score = scoreMatch(searchName, query);
      return {
        id: String(doc.event_id),
        name: doc.event_name || "Tournament",
        year: doc.year ?? null,
        format: doc.type || "",
        status: "completed",
        score,
      };
    })
    .filter((t) => {
      if (Number.isFinite(season) && season > 0 && t.year !== season) return false;
      if (format && String(t.format).toUpperCase() !== format) return false;
      return true;
    });

  const allTournaments = [...tournaments, ...archiveTournaments]
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if ((b.year || 0) !== (a.year || 0)) return (b.year || 0) - (a.year || 0);
      return a.name.localeCompare(b.name);
    })
    .slice(0, limit)
    .map(({ score, ...rest }) => rest);

  const payload = {
    query: queryRaw,
    results: { players, teams, tournaments: allTournaments },
    totals: {
      players: players.length,
      teams: teams.length,
      tournaments: allTournaments.length,
    },
  };

  setCached(cacheKey, payload, CACHE_TTL_MS);
  return NextResponse.json(payload, {
    headers: { "Cache-Control": "public, max-age=15" },
  });
}
