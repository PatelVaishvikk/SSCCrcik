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

function getLogoUrl(filename) {
  if (!filename) return null;
  if (filename.startsWith("http")) return filename;
  return `https://media.cricheroes.in/team_logo/${filename}`;
}

async function run() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  console.log("Searching for FULL.json files...");
  
  // Custom recursive finder without glob
  const dataRoot = path.resolve(process.cwd(), "..");
  const dirs = fs.readdirSync(dataRoot).filter(f => f.startsWith("data_") && fs.statSync(path.join(dataRoot, f)).isDirectory());
  
  let jsonFiles = [];
  for (const d of dirs) {
     const dirPath = path.join(dataRoot, d);
     const subfiles = fs.readdirSync(dirPath).filter(f => f.endsWith("FULL.json"));
     subfiles.forEach(f => jsonFiles.push(path.join(dirPath, f)));
  }

  // Also check root for 2025.json etc if needed, but FULL.json usually has the flat match list
  // 2025.json structure is complex, FULL.json is simpler.

  console.log(`Found ${jsonFiles.length} FULL.json files.`);

  const teamLogos = new Map(); // team_id (numeric string) -> logo_url

  for (const file of jsonFiles) {
    console.log(`Processing ${file}...`);
    const content = fs.readFileSync(file, "utf8");
    try {
      const data = JSON.parse(content);
      // FULL.json often has "matches" array or it IS the match object?
      // Step 305/304 grep suggests distinct files, let's assume it's a list or object containing matches.
      // Usually "FULL.json" in this dataset context means structure with { matches: [...] } or similar
      
      let matches = [];
      if (Array.isArray(data)) {
        matches = data;
      } else if (data.matches && Array.isArray(data.matches)) {
        matches = data.matches;
      } else if (data.tabs && data.tabs.matches && data.tabs.matches.data && Array.isArray(data.tabs.matches.data)) {
        matches = data.tabs.matches.data;
      } else if (data.match_id) {
         matches = [data]; 
      }

      for (const item of matches) {
         // Some files have match data in "summary" property, others at root
         const m = item.summary || item;
         
         if (m.team_a_id && m.team_a_logo) {
            teamLogos.set(String(m.team_a_id), getLogoUrl(m.team_a_logo));
         }
         if (m.team_b_id && m.team_b_logo) {
            teamLogos.set(String(m.team_b_id), getLogoUrl(m.team_b_logo));
         }
      }
    } catch (err) {
      console.error(`Error parsing ${file}:`, err.message);
    }
  }

  console.log(`Extracted ${teamLogos.size} unique team logos.`);

  if (teamLogos.size > 0) {
      console.log("Updating managed_teams...");
      const teams = await db.collection("managed_teams").find({}).toArray();
      let updated = 0;
      
      for (const team of teams) {
        if (!team.source_team_id) continue;
        const logo = teamLogos.get(String(team.source_team_id));
        
        if (logo && (!team.logo || team.logo !== logo)) {
            await db.collection("managed_teams").updateOne(
                { _id: team._id },
                { $set: { logo: logo, profile_photo: logo, updated_at: new Date() } }
            );
            updated++;
        }
      }
      console.log(`Updated ${updated} managed_teams.`);
  }

  await client.close();
}

run().catch(console.error);
