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

  const matches = await db.collection("matches").find({}).toArray();
  let count = 0;
  let examples = [];

  for (const match of matches) {
    if (match.match_data?.team_a_logo || match.match_data?.team_b_logo) {
      count++;
      if (examples.length < 3) {
        examples.push({
             id: match.match_id,
             a: match.match_data?.team_a_logo,
             b: match.match_data?.team_b_logo
        });
      }
    }
  }

  console.log(`Matches with logos: ${count} / ${matches.length}`);
  console.log("Examples:", JSON.stringify(examples, null, 2));

  await client.close();
}

run().catch(console.error);
