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

  console.log("Checking 2025 Events...");
  const events = await db.collection("events").find({ year: 2025 }).toArray();
  
  if (events.length === 0) {
      console.log("No events found for year 2025!");
  } else {
      console.log(`Found ${events.length} events for 2025.`);
      
      let eventsWithLogos = 0;
      let totalMatches = 0;
      let matchesWithLogos = 0;
      const uniqueTeams = new Set();
      const teamsMissingLogo = new Set();

      for (const event of events) {
          const schedule = event.combined?.schedule || [];
          totalMatches += schedule.length;
          
          let eventHasLogos = false;
          for (const match of schedule) {
              if (match.team_a_id) uniqueTeams.add(String(match.team_a_id));
              if (match.team_b_id) uniqueTeams.add(String(match.team_b_id));
              
              if (match.team_a_logo?.startsWith("/team-logos")) {
                  eventHasLogos = true;
                  matchesWithLogos++;
              } else if (match.team_a_id) {
                  teamsMissingLogo.add(String(match.team_a_id));
              }

               if (match.team_b_logo?.startsWith("/team-logos")) {
                  eventHasLogos = true;
                  matchesWithLogos++; // Counting twice per match technically if both have it
              } else if (match.team_b_id) {
                   teamsMissingLogo.add(String(match.team_b_id));
              }
          }
           if (eventHasLogos) eventsWithLogos++;
      }
      
      console.log(`Events with at least one local logo: ${eventsWithLogos} / ${events.length}`);
      console.log(`Total Matches: ${totalMatches}`);
      console.log(`Matches with local logos: ${matchesWithLogos} (note: count is per-team slot)`);
      console.log(`Unique Teams involved: ${uniqueTeams.size}`);
      console.log(`Teams missing logo in matches: ${teamsMissingLogo.size}`);
      
      if (teamsMissingLogo.size > 0 && teamsMissingLogo.size < 10) {
          console.log("Sample missing teams:", [...teamsMissingLogo]);
      }
      
       // Check managed_teams for missing
       if (teamsMissingLogo.size > 0) {
          const missing = [...teamsMissingLogo];
          const foundInManaged = await db.collection("managed_teams").find({ source_team_id: { $in: missing } }).toArray();
          console.log(`Of the ${missing.length} missing teams, ${foundInManaged.length} exist in managed_teams.`);
          
          foundInManaged.slice(0, 3).forEach(t => {
              console.log(`Team ${t.name} (Source: ${t.source_team_id}) -> managed logo: ${t.logo}`);
          });
       }
  }

  await client.close();
}

run().catch(console.error);
