import { MongoClient } from "mongodb";
import path from "path";
import fs from "fs";

// Load env
const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  const raw = fs.readFileSync(envPath, "utf8");
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

const uri = process.env.MONGO_URL || process.env.MONGODB_URI;
if (!uri) {
  console.error("Missing MONGO_URL");
  process.exit(1);
}

const dbName = process.env.MONGO_DB_NAME || "ssc";

async function run() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  console.log("--- MATCHES COLLECTION SAMPLE ---");
  const match = await db.collection("matches").findOne({});
  if (match) {
    console.log(`match_id: ${match.match_id} (${typeof match.match_id})`);
    console.log(`tournament_id: ${match.tournament_id} (${typeof match.tournament_id})`);
    console.log(`Logos: A=${match.match_data?.team_a_logo}, B=${match.match_data?.team_b_logo}`);
  } else {
    console.log("No matches found.");
  }

  console.log("\n--- MANAGED_MATCHES COLLECTION SAMPLE ---");
  const managed = await db.collection("managed_matches").findOne({});
  if (managed) {
    console.log(`match_id: ${managed.match_id} (${typeof managed.match_id})`);
    console.log(`tournament_id: ${managed.tournament_id} (${typeof managed.tournament_id})`);
  } else {
    console.log("No managed_matches found.");
  }

  await client.close();
}

run().catch(console.error);
