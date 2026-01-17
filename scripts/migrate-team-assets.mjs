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

  console.log("Scanning matches for logos...");
  const matches = await db.collection("matches").find({}).toArray();
  
  const logoMap = new Map(); // source_team_id -> logo_url

  let foundLogos = 0;
  for (const match of matches) {
    if (!match.match_data) continue;
    
    // Team A
    if (match.match_data.team_a_id && match.match_data.team_a_logo) {
       const url = match.match_data.team_a_logo;
       if (url.startsWith("http")) {
         logoMap.set(String(match.match_data.team_a_id), url);
         foundLogos++;
       }
    }

    // Team B
    if (match.match_data.team_b_id && match.match_data.team_b_logo) {
       const url = match.match_data.team_b_logo;
       if (url.startsWith("http")) {
         logoMap.set(String(match.match_data.team_b_id), url);
         foundLogos++;
       }
    }
  }

  console.log(`Found ${logoMap.size} unique teams with logos.`);

  console.log("Updating managed_teams...");
  const teams = await db.collection("managed_teams").find({}).toArray();
  
  let updated = 0;
  for (const team of teams) {
    if (!team.source_team_id) continue;
    
    const logo = logoMap.get(String(team.source_team_id));
    if (logo && (!team.logo || team.logo !== logo)) {
      await db.collection("managed_teams").updateOne(
        { _id: team._id },
        { $set: { logo: logo, updated_at: new Date() } }
      );
      updated++;
    }
    // Also update profile_photo just in case logic uses that
    if (logo && (!team.profile_photo || team.profile_photo !== logo)) {
       await db.collection("managed_teams").updateOne(
        { _id: team._id },
        { $set: { profile_photo: logo } }
      );
    }
  }

  console.log(`Updated ${updated} teams.`);
  await client.close();
}

run().catch(console.error);
