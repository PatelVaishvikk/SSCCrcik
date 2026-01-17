import type { Db } from "mongodb";

export const MAX_PREFIX_LENGTH = 20;
let searchIndexesReady = false;

export function normalizeSearchText(text: string) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function tokenizeSearchText(text: string) {
  const normalized = normalizeSearchText(text);
  return normalized ? normalized.split(/\s+/).filter(Boolean) : [];
}

export function buildPrefixes(text: string) {
  const tokens = tokenizeSearchText(text);
  const prefixes = new Set<string>();
  tokens.forEach((token) => {
    const limit = Math.min(token.length, MAX_PREFIX_LENGTH);
    for (let i = 1; i <= limit; i += 1) {
      prefixes.add(token.slice(0, i));
    }
  });
  return Array.from(prefixes.values());
}

export function buildPrefixQuery(tokens: string[]) {
  if (!tokens.length) return null;
  if (tokens.length === 1) return tokens[0];
  return { $all: tokens };
}

export function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function scoreMatch(nameLower: string, queryLower: string) {
  if (!queryLower) return 0;
  if (nameLower === queryLower) return 100;
  if (nameLower.startsWith(queryLower)) return 80;
  const idx = nameLower.indexOf(queryLower);
  if (idx >= 0) return 50 - Math.min(idx, 20);
  return 0;
}

export async function ensureSearchIndexes(db: Db) {
  if (searchIndexesReady) return;
  await Promise.all([
    db.collection("managed_tournaments").createIndex({ search_prefixes: 1 }),
    db.collection("managed_tournaments").createIndex({ year: 1, format: 1 }),
    db.collection("managed_teams").createIndex({ search_prefixes: 1 }),
    db.collection("managed_teams").createIndex({ tournament_id: 1 }),
    db.collection("events").createIndex({ search_prefixes: 1 }),
    db.collection("search_players").createIndex({ search_prefixes: 1 }),
    db.collection("search_players").createIndex({ city_prefixes: 1 }),
    db.collection("search_players").createIndex({ player_id: 1 }),
  ]);
  searchIndexesReady = true;
}
