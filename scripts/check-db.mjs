
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

loadEnv(path.resolve(process.cwd(), ".env"));

const uri = process.env.MONGO_URL || process.env.MONGODB_URI;
const dbName = process.env.MONGO_DB_NAME || "ssc";

async function check() {
  const client = await new MongoClient(uri).connect();
  const db = client.db(dbName);

  const eventCount = await db.collection("events").countDocuments();
  const managedCount = await db.collection("managed_tournaments").countDocuments();
  const matchCount = await db.collection("matches").countDocuments();
  const managedMatchCount = await db.collection("managed_matches").countDocuments();

  console.log("Events (Archive):", eventCount);
  console.log("Managed Tournaments:", managedCount);
  console.log("Matches (Archive):", matchCount);
  console.log("Managed Matches:", managedMatchCount);

  if (eventCount > 0) {
      const sample = await db.collection("events").findOne({}, { projection: { year: 1, event_name: 1 } });
      console.log("Sample Event:", sample);
  }
   if (managedCount > 0) {
      const sample = await db.collection("managed_tournaments").findOne({}, { projection: { year: 1, name: 1 } });
      console.log("Sample Managed Tournament:", sample);
  }

  await client.close();
}

check().catch(console.error);
