import { MongoClient } from "mongodb";
import path from "path";
import fs from "fs";
import https from "https";
import { pipeline } from "stream";
import { promisify } from "util";

const streamPipeline = promisify(pipeline);

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
const PUBLIC_DIR = path.resolve(process.cwd(), "public");
const LOGO_DIR = path.join(PUBLIC_DIR, "team-logos");

if (!fs.existsSync(LOGO_DIR)) {
  fs.mkdirSync(LOGO_DIR, { recursive: true });
}

function getLogoUrl(filename) {
  if (!filename) return null;
  if (filename.startsWith("http")) return filename;
  return `https://media.cricheroes.in/team_logo/${filename}`;
}

async function downloadImage(url, dest) {
  if (fs.existsSync(dest)) return true; // Already downloaded

  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        // console.error(`Failed to download ${url}: ${response.statusCode}`);
        // reject(new Error(`Status ${response.statusCode}`));
        // We'll just resolve false to avoid crashing the whole script
        resolve(false);
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve(true);
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => {}); // Delete failed file
      resolve(false); // Resolve false on error
    });
  });
}

async function run() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  console.log("Searching for FULL.json files to identify targets...");
  
  const dataRoot = path.resolve(process.cwd(), "..");
  const dirs = fs.readdirSync(dataRoot).filter(f => f.startsWith("data_") && fs.statSync(path.join(dataRoot, f)).isDirectory());
  
  let jsonFiles = [];
  for (const d of dirs) {
     const dirPath = path.join(dataRoot, d);
     const subfiles = fs.readdirSync(dirPath).filter(f => f.endsWith("FULL.json"));
     subfiles.forEach(f => jsonFiles.push(path.join(dirPath, f)));
  }

  console.log(`Found ${jsonFiles.length} FULL.json files.`);

  const teamLogos = new Map(); // team_id -> { remoteUrl, filename }

  for (const file of jsonFiles) {
    const content = fs.readFileSync(file, "utf8");
    try {
      const data = JSON.parse(content);
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
         const m = item.summary || item;
         
         if (m.team_a_id && m.team_a_logo) {
            const url = getLogoUrl(m.team_a_logo);
            const filename = path.basename(m.team_a_logo).split('?')[0]; // Clean filename
            if (filename && filename.endsWith('.jpg') || filename.endsWith('.png') || filename.endsWith('.jpeg')) {
                teamLogos.set(String(m.team_a_id), { url, filename });
            }
         }
         if (m.team_b_id && m.team_b_logo) {
            const url = getLogoUrl(m.team_b_logo);
            const filename = path.basename(m.team_b_logo).split('?')[0];
            if (filename && filename.endsWith('.jpg') || filename.endsWith('.png') || filename.endsWith('.jpeg')) {
                teamLogos.set(String(m.team_b_id), { url, filename });
            }
         }
      }
    } catch (err) {
      console.error(`Error parsing ${file}:`, err.message);
    }
  }

  console.log(`Found ${teamLogos.size} teams with potential logos.`);
  
  // Download Queue
  let downloadedCount = 0;
  for (const [teamId, { url, filename }] of teamLogos.entries()) {
      const dest = path.join(LOGO_DIR, filename);
      const success = await downloadImage(url, dest);
      if (success) {
          downloadedCount++;
          // Mark as success by setting local path property on the map value
          teamLogos.get(teamId).localPath = `/team-logos/${filename}`;
      } else {
        //   console.log(`Failed to download for team ${teamId}`);
      }
  }

  console.log(`Downloaded/Verified ${downloadedCount} images.`);

  // Update managed_teams
  console.log("Updating managed_teams with local paths...");
  const teams = await db.collection("managed_teams").find({}).toArray();
  let updated = 0;
  
  for (const team of teams) {
    if (!team.source_team_id) continue;
    
    const entry = teamLogos.get(String(team.source_team_id));
    
    if (entry && entry.localPath) {
        // Only update if it's different
        if (team.logo !== entry.localPath) {
            await db.collection("managed_teams").updateOne(
                { _id: team._id },
                { $set: { logo: entry.localPath, profile_photo: entry.localPath, updated_at: new Date() } }
            );
            updated++;
        }
    }
  }
  console.log(`Updated ${updated} managed_teams to use local images.`);

  // Update EVENTS (Historical)
  console.log("Updating events collection with local paths...");
  const events = await db.collection("events").find({}).toArray();
  let updatedEvents = 0;
  let updatedMatches = 0;

  for (const event of events) {
      if (!event.combined || !event.combined.schedule) continue;
      
      let modified = false;
      const schedule = event.combined.schedule;
      
      for (const match of schedule) {
          // Team A
          if (match.team_a_id) {
              const entry = teamLogos.get(String(match.team_a_id));
              if (entry && entry.localPath && match.team_a_logo !== entry.localPath) {
                  match.team_a_logo = entry.localPath;
                  modified = true;
                  updatedMatches++;
              }
          }
          // Team B
          if (match.team_b_id) {
              const entry = teamLogos.get(String(match.team_b_id));
              if (entry && entry.localPath && match.team_b_logo !== entry.localPath) {
                  match.team_b_logo = entry.localPath;
                  modified = true;
                  updatedMatches++;
              }
          }
      }

      if (modified) {
          await db.collection("events").updateOne(
              { _id: event._id },
              { $set: { "combined.schedule": schedule } }
          );
          updatedEvents++;
      }
  }
  console.log(`Updated ${updatedMatches} matches across ${updatedEvents} events.`);
  
  await client.close();
}

run().catch(console.error);
