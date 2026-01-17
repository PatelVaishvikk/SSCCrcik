import fs from "fs";
import path from "path";
import { MongoClient } from "mongodb";

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, "utf8");
  raw.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const idx = trimmed.indexOf("=");
    if (idx === -1) return;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  });
}

const MAX_PREFIX_LENGTH = 20;

const ALIASES = {
  ACT: "Atmiya Cricket Tournament",
  ABCT: "Atmiya Box Cricket Tournament",
};

function normalizeSearchText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenizeSearchText(text) {
  const normalized = normalizeSearchText(text);
  return normalized ? normalized.split(/\s+/).filter(Boolean) : [];
}

function buildPrefixes(text) {
  const tokens = tokenizeSearchText(text);
  const prefixes = new Set();
  tokens.forEach((token) => {
    const limit = Math.min(token.length, MAX_PREFIX_LENGTH);
    for (let i = 1; i <= limit; i += 1) {
      prefixes.add(token.slice(0, i));
    }
  });
  return Array.from(prefixes.values());
}

function buildPlayerSearchDoc({
  playerId,
  profile,
  tournaments,
  source,
  roleOverride,
}) {
  const name = String(profile?.name || "Unknown").trim();
  const city = String(profile?.city_name || "").trim();
  const role =
    roleOverride ||
    String(profile?.playing_role || profile?.batting_hand || "").trim();
  const battingHand = String(profile?.batting_hand || "").trim();
  const bowlingStyle = String(profile?.bowling_style || "").trim();
  const photo = String(profile?.profile_photo || "").trim();
  const searchInput = `${name} ${city}`.trim();
  const searchName = normalizeSearchText(searchInput);
  const searchPrefixes = buildPrefixes(searchInput);
  const cityPrefixes = city ? buildPrefixes(city) : [];
  return {
    player_id: playerId,
    name,
    city,
    role,
    batting_hand: battingHand,
    bowling_style: bowlingStyle,
    photo,
    tournaments: Number(tournaments || 0),
    source,
    search_name: searchName,
    search_prefixes: searchPrefixes,
    city_prefixes: cityPrefixes,
    updated_at: new Date(),
  };
}

loadEnv(path.resolve(process.cwd(), ".env"));

const uri = process.env.MONGO_URL || process.env.MONGODB_URI;
if (!uri) {
  console.error("Missing MONGO_URL or MONGODB_URI in environment.");
  process.exit(1);
}

const dbName = process.env.MONGO_DB_NAME || "ssc";
const client = new MongoClient(uri, { maxPoolSize: 5 });

async function backfill() {
  await client.connect();
  const db = client.db(dbName);

  await Promise.all([
    db.collection("managed_tournaments").createIndex({ search_prefixes: 1 }),
    db.collection("managed_tournaments").createIndex({ year: 1, format: 1 }),
    db.collection("managed_teams").createIndex({ search_prefixes: 1 }),
    db.collection("managed_teams").createIndex({ tournament_id: 1 }),
    db.collection("search_players").createIndex({ search_prefixes: 1 }),
    db.collection("search_players").createIndex({ city_prefixes: 1 }),
    db.collection("search_players").createIndex({ player_id: 1 }),
  ]);

  const tournamentDocs = await db
    .collection("managed_tournaments")
    .find({}, { projection: { tournament_id: 1, name: 1 } })
    .toArray();
  if (tournamentDocs.length) {
    const ops = tournamentDocs.map((doc) => {
      const name = String(doc.name || "").trim();
      let searchName = normalizeSearchText(name);
      
      // Expand aliases
      for (const [key, value] of Object.entries(ALIASES)) {
        if (name.includes(key)) {
          const expanded = name.replace(key, value);
          searchName += " " + normalizeSearchText(expanded);
        }
      }

      const searchPrefixes = buildPrefixes(searchName);
      return {
        updateOne: {
          filter: { tournament_id: doc.tournament_id },
          update: {
            $set: {
              search_name: searchName,
              search_prefixes: searchPrefixes,
              updated_at: new Date(),
            },
          },
        },
      };
    });
    await db.collection("managed_tournaments").bulkWrite(ops, { ordered: false });
    console.log(`Updated ${tournamentDocs.length} tournaments.`);
  }

  const eventDocs = await db
    .collection("events")
    .find({}, { projection: { event_id: 1, event_name: 1 } })
    .toArray();
  if (eventDocs.length) {
    const ops = eventDocs.map((doc) => {
      const name = String(doc.event_name || "").trim();
      const searchName = normalizeSearchText(name);
      const searchPrefixes = buildPrefixes(name);
      return {
        updateOne: {
          filter: { event_id: doc.event_id },
          update: {
            $set: {
              search_name: searchName,
              search_prefixes: searchPrefixes,
              updated_at: new Date(),
            },
          },
        },
      };
    });
    await db.collection("events").bulkWrite(ops, { ordered: false });
    console.log(`Updated ${eventDocs.length} archive events.`);
  }

  const teamDocs = await db
    .collection("managed_teams")
    .find({}, { projection: { team_id: 1, name: 1, short_name: 1 } })
    .toArray();
  if (teamDocs.length) {
    const ops = teamDocs.map((doc) => {
      const name = String(doc.name || "").trim();
      const shortName = String(doc.short_name || "").trim();
      const combined = `${name} ${shortName}`.trim();
      const searchName = normalizeSearchText(combined);
      const searchPrefixes = buildPrefixes(combined);
      return {
        updateOne: {
          filter: { team_id: doc.team_id },
          update: {
            $set: {
              search_name: searchName,
              search_prefixes: searchPrefixes,
              updated_at: new Date(),
            },
          },
        },
      };
    });
    await db.collection("managed_teams").bulkWrite(ops, { ordered: false });
    console.log(`Updated ${teamDocs.length} teams.`);
  }

  const meta =
    (await db.collection("meta").findOne({ key: "player_history" })) ||
    (await db.collection("meta").findOne({ key: "global_player_database" }));
  const playerData = meta?.data?.players || {};
  const playerOps = [];
  let playerCount = 0;

  for (const [key, player] of Object.entries(playerData)) {
    const playerId = String(player?.player_id || key);
    const profile = player?.profile || {};
    const tournaments = player?.ssc_tournaments_played || 0;
    const doc = buildPlayerSearchDoc({
      playerId,
      profile,
      tournaments,
      source: "global",
    });
    playerOps.push({
      updateOne: {
        filter: { player_id: playerId },
        update: {
          $set: doc,
          $setOnInsert: { created_at: new Date() },
        },
        upsert: true,
      },
    });
    playerCount += 1;
    if (playerOps.length >= 1000) {
      await db.collection("search_players").bulkWrite(playerOps, { ordered: false });
      playerOps.length = 0;
    }
  }

  if (playerOps.length) {
    await db.collection("search_players").bulkWrite(playerOps, { ordered: false });
  }
  if (playerCount) {
    console.log(`Upserted ${playerCount} global players into search_players.`);
  }

  const customPlayers = await db.collection("custom_players").find({}).toArray();
  if (customPlayers.length) {
    const customOps = customPlayers.map((player) => {
      const playerId = String(player.player_id);
      const profile = player.profile || {};
      const doc = buildPlayerSearchDoc({
        playerId,
        profile,
        tournaments: player.ssc_tournaments_played || 0,
        source: "custom",
        roleOverride: String(profile?.playing_role || "").trim(),
      });
      return {
        updateOne: {
          filter: { player_id: playerId },
          update: {
            $set: doc,
            $setOnInsert: { created_at: player.created_at || new Date() },
          },
          upsert: true,
        },
      };
    });
    await db.collection("search_players").bulkWrite(customOps, { ordered: false });
    console.log(`Upserted ${customPlayers.length} custom players into search_players.`);
  }
}

backfill()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.close();
  });
