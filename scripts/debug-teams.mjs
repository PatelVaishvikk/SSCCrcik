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

  console.log("--- MANAGED_TEAMS SAMPLE ---");
  const team = await db.collection("managed_teams").findOne({});
  console.log(JSON.stringify(team, null, 2));

  console.log("\n--- COUNT ---");
  const count = await db.collection("managed_teams").countDocuments();
  console.log(`Total managed teams: ${count}`);

  await client.close();
}

run().catch(console.error);
