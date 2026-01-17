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

  console.log("Reading from matches...");
  const matches = await db.collection("matches").find({}).toArray();
  console.log(`Found ${matches.length} matches in archive.`);

  let updated = 0;
  for (const match of matches) {
    if (!match.match_data) continue;
    
    // Check if we have logos to sync
    const teamALogo = match.match_data.team_a_logo;
    const teamBLogo = match.match_data.team_b_logo;

    if (!teamALogo && !teamBLogo) continue;

    const filter = { 
       match_id: match.match_id,
       tournament_id: match.tournament_id
    };

    const update = {};
    if (teamALogo) update.team_a_logo = teamALogo;
    if (teamBLogo) update.team_b_logo = teamBLogo;

    if (Object.keys(update).length > 0) {
       const res = await db.collection("managed_matches").updateOne(filter, { $set: update });
       if (res.modifiedCount > 0) updated++;
    }
  }

  console.log(`Updated ${updated} documents in managed_matches.`);
  await client.close();
}

run().catch(console.error);
