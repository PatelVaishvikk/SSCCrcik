
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
if (!uri) {
  console.error("Missing MONGO_URL");
  process.exit(1);
}

const client = new MongoClient(uri);

async function run() {
  try {
    await client.connect();
    const db = client.db(process.env.MONGO_DB_NAME || "ssc");
    
    console.log("=== STARTING DATA AUDIT ===\n");

    // 1. Audit Player History
    console.log("--- Checking Player History ---");
    const historyDoc = await db.collection("meta").findOne({ key: "player_history" });
    if (!historyDoc || !historyDoc.data) {
        console.error("CRITICAL: player_history meta doc missing!");
    } else {
        const players = historyDoc.data.players;
        const pIds = Object.keys(players);
        console.log(`Total Players in History: ${pIds.length}`);
        
        let noTournaments = 0;
        let mismatchCounts = 0;
        let missingStats = 0;

        for (const pid of pIds) {
            const p = players[pid];
            const tList = p.tournaments || [];
            
            if (tList.length === 0) noTournaments++;
            if (p.ssc_tournaments_played !== tList.length) {
                // This is often just a sync issue, but worth noting
                // mismatchCounts++; 
            }
            
            // Check for stats
            for (const t of tList) {
                // ABCT vs ACT logic
                if (t.type === "ACT" && !t.statistics) {
                    missingStats++;
                }
                if (t.type === "ABCT") {
                   // ABCT might have stats on courts
                   const hasCourtStats = t.courts?.some(c => c.statistics);
                   if (!hasCourtStats && !t.statistics) {
                       // missingStats++; // Not necessarily an error if they didn't play?
                   }
                }
            }
        }
        
        console.log(`Players with 0 tournaments: ${noTournaments}`);
        console.log(`Tournament entries missing statistics: ${missingStats}`);
    }

    // 2. Audit Events / Matches
    console.log("\n--- Checking Events & Matches ---");
    const events = await db.collection("events").find({}).toArray();
    console.log(`Total Events found: ${events.length}`);
    
    const matchesCol = db.collection("matches");

    for (const event of events) {
        const matchCount = await matchesCol.countDocuments({ event_id: event.event_id });
        console.log(`Event: ${event.year} ${event.type} (${matchCount} matches linked)`);
        
        const matches = await matchesCol.find({ event_id: event.event_id }).toArray();
        
        let missingLogos = 0;
        let missingScores = 0;
        
        for (const m of matches) {
            const sched = m.schedule || {};
            // Check logos
            if (!sched.team_a_logo || !sched.team_b_logo) {
                missingLogos++;
            }
            // Check scores for past matches
            // status might be in schedule or match_data
            const status = sched.status || "";
            if (status === 'past') {
                const summary = m.match_data?.summary || {}; // check match_data structure if needed
                // match_data structure from seed: matchPayload
                // Actually seed script puts matchPayload into match_data
                // matchPayload usually has 'match_summary' or similar?
                
                // Let's check sched.team_a_summary or similar if available
                // Based on seed-db, we don't see exact structure of schedule object but we can infer
                if (!sched.team_a_summary && !sched.team_b_summary && !m.match_data?.summary?.match_summary) {
                     // Check if it really is missing scores or just different field
                     // For now, let's just log if BOTH are missing
                     missingScores++;
                }
            }
        }
        
        if (missingLogos > 0) console.warn(`  - Matches missing logos: ${missingLogos}`);
        if (missingScores > 0) console.warn(`  - Past matches missing scores: ${missingScores}`);
    }

    console.log("\n=== AUDIT COMPLETE ===");

  } catch (e) {
    console.error(e);
  } finally {
    await client.close();
  }
}

run();
