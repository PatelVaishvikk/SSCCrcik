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

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

loadEnv(path.resolve(process.cwd(), ".env"));

const uri = process.env.MONGO_URL || process.env.MONGODB_URI;
if (!uri) {
  console.error("Missing MONGO_URL or MONGODB_URI in environment.");
  process.exit(1);
}

const dbName = process.env.MONGO_DB_NAME || "ssc";
const dataRoot = process.env.DATA_ROOT
  ? path.resolve(process.env.DATA_ROOT)
  : path.resolve(process.cwd(), "..");

const yearFiles = fs
  .readdirSync(dataRoot)
  .filter((file) => /^\d{4}\.json$/.test(file))
  .sort();

if (!yearFiles.length) {
  console.error(`No year files found in ${dataRoot}`);
  process.exit(1);
}

const client = new MongoClient(uri, { maxPoolSize: 5 });

async function seed() {
  await client.connect();
  const db = client.db(dbName);

  const yearsCol = db.collection("years");
  const eventsCol = db.collection("events");
  const matchesCol = db.collection("matches");
  const metaCol = db.collection("meta");

  if (process.env.RESET_DB === "true") {
    console.log("Resetting collections...");
    await Promise.all([
      yearsCol.deleteMany({}),
      eventsCol.deleteMany({}),
      matchesCol.deleteMany({}),
      metaCol.deleteMany({}),
    ]);
  }

  await Promise.all([
    yearsCol.createIndex({ year: 1 }, { unique: true }),
    eventsCol.createIndex({ event_id: 1 }, { unique: true }),
    eventsCol.createIndex({ year: 1, type: 1 }),
    matchesCol.createIndex({ tournament_id: 1, match_id: 1 }, { unique: true }),
    matchesCol.createIndex({ year: 1 }),
    metaCol.createIndex({ key: 1 }, { unique: true }),
  ]);

  for (const fileName of yearFiles) {
    const filePath = path.join(dataRoot, fileName);
    console.log(`Seeding ${fileName}...`);

    const raw = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(raw);
    const year = Number(data.year || fileName.replace(".json", ""));

    await yearsCol.updateOne(
      { year },
      {
        $set: {
          year,
          generated_at: data.generated_at || null,
          updated_at: new Date(),
        },
      },
      { upsert: true }
    );

    const tournaments = data.tournaments || {};

    for (const [typeKey, typePayload] of Object.entries(tournaments)) {
      const type = String(typeKey).toUpperCase();
      const events = typePayload?.events || [];

      for (let index = 0; index < events.length; index += 1) {
        const event = events[index];
        const eventId = `${year}-${type}-${index + 1}`;
        const combined = event.combined ? { ...event.combined } : {};
        const schedule = combined.schedule || [];
        const playersById = combined.players_by_id || {};

        delete combined.matches_by_id;
        delete combined.full_files;

        const eventDoc = {
          event_id: eventId,
          event_index: index,
          year,
          type,
          event_name: event.event_name,
          start_date: event.start_date,
          end_date: event.end_date,
          merged_from: event.merged_from || null,
          combined,
          schedule_count: schedule.length,
          player_count: Object.keys(playersById).length,
          updated_at: new Date(),
        };

        await eventsCol.updateOne(
          { event_id: eventId },
          { $set: eventDoc },
          { upsert: true }
        );

        const scheduleMap = new Map();
        for (const entry of schedule) {
          if (!entry) continue;
          const key = `${entry.tournament_id}:${entry.match_id}`;
          scheduleMap.set(key, entry);
        }

        const matchesById = event.combined?.matches_by_id || {};
        const matchKeys = new Set([...Object.keys(matchesById), ...scheduleMap.keys()]);

        for (const key of matchKeys) {
          const [tournamentId, matchId] = key.split(":");
          if (!tournamentId || !matchId) continue;

          const scheduleEntry = scheduleMap.get(key) || null;
          if (scheduleEntry) {
            if (scheduleEntry.team_a_logo && !scheduleEntry.team_a_logo.startsWith("http")) {
              scheduleEntry.team_a_logo = `https://media.cricheroes.in/team_logo/${scheduleEntry.team_a_logo}`;
            }
            if (scheduleEntry.team_b_logo && !scheduleEntry.team_b_logo.startsWith("http")) {
              scheduleEntry.team_b_logo = `https://media.cricheroes.in/team_logo/${scheduleEntry.team_b_logo}`;
            }
          }

          const matchPayload = matchesById[key] || null;
          if (matchPayload) {
            if (matchPayload.team_a_logo && !matchPayload.team_a_logo.startsWith("http")) {
              matchPayload.team_a_logo = `https://media.cricheroes.in/team_logo/${matchPayload.team_a_logo}`;
            }
            if (matchPayload.team_b_logo && !matchPayload.team_b_logo.startsWith("http")) {
              matchPayload.team_b_logo = `https://media.cricheroes.in/team_logo/${matchPayload.team_b_logo}`;
            }
          }

          const sortDate = scheduleEntry
            ? parseDate(
                scheduleEntry.match_start_time ||
                  scheduleEntry.created_date ||
                  scheduleEntry.updated_date
              )
            : null;

          const matchDoc = {
            event_id: eventId,
            year,
            type,
            tournament_id: String(tournamentId),
            match_id: String(matchId),
            schedule: scheduleEntry,
            match_data: matchPayload,
            sort_date: sortDate,
            updated_at: new Date(),
          };

          await matchesCol.updateOne(
            { tournament_id: String(tournamentId), match_id: String(matchId) },
            { $set: matchDoc },
            { upsert: true }
          );
        }
      }
    }
  }

  const metaFiles = [
    { key: "player_history", file: "player_history.json" },
    { key: "global_player_database", file: "GLOBAL_PLAYER_DATABASE.json" },
  ];

  for (const meta of metaFiles) {
    const filePath = path.join(dataRoot, meta.file);
    if (!fs.existsSync(filePath)) continue;
    console.log(`Seeding ${meta.file}...`);
    const raw = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(raw);

    await metaCol.updateOne(
      { key: meta.key },
      {
        $set: {
          key: meta.key,
          data,
          updated_at: new Date(),
        },
      },
      { upsert: true }
    );
  }

  console.log("Seed complete.");
}

seed()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.close();
  });
