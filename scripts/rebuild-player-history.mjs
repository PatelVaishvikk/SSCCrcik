
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
  console.error("Missing MONGO_URL or MONGODB_URI in environment.");
  process.exit(1);
}

const dbName = process.env.MONGO_DB_NAME || "ssc";
const dataRoot = process.env.DATA_ROOT
  ? path.resolve(process.env.DATA_ROOT)
  : path.resolve(process.cwd(), "..");

const fullFiles = [
    "data_881370/abct_1_881370_FULL.json",
    "data_1301830/abct_a_1301830_FULL.json",
    "data_613120/abct_2_613120_FULL.json",
    "data_1301896/abct_b_1301896_FULL.json",
    "data_678708/atmiya_cricket_tournament_2023_678708_FULL.json",
    "data_882786/abct_2_882786_FULL.json",
    "data_606302/atmiya_box_cricket_tournament_2023_court_1_606302_FULL.json",
    "complete_tournament_data-20260109T042707Z-3-001/complete_tournament_data/atmiya_cricket_tournament_2025_1381119_FULL.json",
    "data_934835/act_2024_934835_FULL.json"
];

const client = new MongoClient(uri);

async function run() {
  try {
    await client.connect();
    const db = client.db(dbName);
    const metaCol = db.collection("meta");

    // Load existing player_history to preserve profile info if needed
    // Actually, checking GLOBAL_PLAYER_DATABASE.json might be better for profiles
    // But let's verify what we have in DB first.
    const existingHistoryDoc = await metaCol.findOne({ key: "player_history" });
    const playerHistory = existingHistoryDoc?.data || { players: {}, tournament_index: {} };

    console.log(`Loaded player history with ${Object.keys(playerHistory.players).length} players.`);

    // Map tournament IDs to stats
    const tournamentStats = new Map(); // tournament_id -> { batting: { playerId: stats }, bowling: ... }

    for (const relPath of fullFiles) {
        const fullPath = path.join(dataRoot, relPath);
        if (!fs.existsSync(fullPath)) {
            console.warn(`File not found: ${fullPath}`);
            continue;
        }

        console.log(`Processing ${relPath}...`);
        const raw = fs.readFileSync(fullPath, "utf8");
        const data = JSON.parse(raw);
        const tournamentId = data.meta.tournament_id;

        if (!data.tabs || !data.tabs.leaderboards) {
            console.warn(`No leaderboards in ${tournamentId}`);
            continue;
        }

        const tStats = {
            batting: {},
            bowling: {},
            fielding: {}
        };
        
        // Process Batting
        if (data.tabs.leaderboards.batting) {
            for (const entry of data.tabs.leaderboards.batting) {
                const pid = String(entry.player_id);
                // Map fields to our schema
                // "Matches", "Innings", "Not out", "Runs", "Highest Runs", "Avg", "SR", "30s", "50s", "100s", "4s", "6s", "Ducks", "Won", "Loss"
                tStats.batting[pid] = [
                    { title: "Matches", value: entry.total_match, is_user_property: 1 },
                    { title: "Innings", value: entry.innings },
                    { title: "Not out", value: entry.not_out },
                    { title: "Runs", value: entry.total_runs, is_user_property: 1 },
                    { title: "Highest Runs", value: entry.highest_run + (entry.highest_run_with_not_out ? '*' : '') },
                    { title: "Avg", value: entry.average },
                    { title: "SR", value: entry.strike_rate },
                    { title: "4s", value: entry["4s"] },
                    { title: "6s", value: entry["6s"] },
                    { title: "50s", value: entry["50s"] },
                    { title: "100s", value: entry["100s"] }
                ];
            }
        }

        // Process Bowling
        if (data.tabs.leaderboards.bowling) {
            for (const entry of data.tabs.leaderboards.bowling) {
                const pid = String(entry.player_id);
                // "Matches", "Innings", "Overs", "Maidens", "Wickets", "Runs", "Best Bowling", "3 Wickets", "5 Wickets", "Economy", "SR", "Avg", "Wides", "NoBalls", "Dot Balls"
                tStats.bowling[pid] = [
                    { title: "Matches", value: entry.total_match, is_user_property: 1 },
                    { title: "Innings", value: entry.innings },
                    { title: "Overs", value: entry.overs },
                    { title: "Maidens", value: entry.maiden_overs },
                    { title: "Wickets", value: entry.total_wickets, is_user_property: 1 },
                    { title: "Runs", value: entry.runs },
                    { title: "Best Bowling", value: entry.best_bowling_figure }, // e.g. "5/4"
                    { title: "Economy", value: entry.economy },
                    { title: "SR", value: entry.strike_rate },
                    { title: "Avg", value: entry.average },
                    { title: "Wides", value: entry.wide_balls },
                    { title: "NoBalls", value: entry.no_balls },
                     { title: "3 Wickets", value: entry["3_wickets"] || 0 }, // Adjust key if needed
                     { title: "5 Wickets", value: entry["5_wickets"] || 0 }
                ];
            }
        }
        
        // Process Fielding
         if (data.tabs.leaderboards.fielding) {
            for (const entry of data.tabs.leaderboards.fielding) {
                const pid = String(entry.player_id);
                tStats.fielding[pid] = [
                    { title: "Matches", value: entry.total_match },
                    { title: "Catches", value: entry.catches },
                    { title: "Run outs", value: entry.run_out },
                    { title: "Stumpings", value: entry.stumping }
                ];
            }
        }

        tournamentStats.set(tournamentId, tStats);
    }

    // Now update player_history
    let updatedCount = 0;
    for (const [playerId, player] of Object.entries(playerHistory.players)) {
        if (!player.tournaments) continue;

        let changed = false;
        // Iterate player's tournaments
        for (const tEntry of player.tournaments) {
            // Check courts if ABCT (merged)
            // But wait, the schema uses 'statistics' on the court entry for merged, or on the main entry for single?
            // "ABCT-2023" has "courts": [ { tournament_id: "606302", ... statistics: {} } ]
            // "ACT" has "statistics": {} directly.
            
            // Handle ACT (direct)
            if (tEntry.type === "ACT") {
                const tId = tEntry.tournament_id;
                const stats = tournamentStats.get(tId);
                if (stats) {
                    const batting = stats.batting[playerId];
                    const bowling = stats.bowling[playerId];
                    const fielding = stats.fielding[playerId];
                    
                    if (batting || bowling || fielding) {
                        tEntry.statistics = {
                            batting: batting || [],
                            bowling: bowling || [],
                            fielding: fielding || []
                        };
                        changed = true;
                    }
                }
            }
            
            // Handle ABCT (courts)
            if (tEntry.type === "ABCT" && tEntry.courts) {
                for (const court of tEntry.courts) {
                    const tId = court.tournament_id;
                    const stats = tournamentStats.get(tId);
                    if (stats) {
                        const batting = stats.batting[playerId];
                        const bowling = stats.bowling[playerId];
                        const fielding = stats.fielding[playerId];
                         if (batting || bowling || fielding) {
                            court.statistics = {
                                batting: batting || [],
                                bowling: bowling || [],
                                fielding: fielding || []
                            };
                            changed = true;
                        }
                    }
                }
                // Also clear the main 'statistics' on the ABCT entry itself if it was wrongly populated? 
                // The current JSON had 'statistics': null for ABCT parent, which is correct.
            }
        }
        if (changed) updatedCount++;
    }

    console.log(`Updated stats for ${updatedCount} players.`);

    // Persist to DB and File
    if (process.argv.includes("--dry-run")) {
        console.log("Dry run, not saving.");
    } else {
        await metaCol.updateOne(
            { key: "player_history" },
            { $set: { data: playerHistory, updated_at: new Date() } }
        );
        console.log("Updated player_history in MongoDB.");
        
         // Save to file for reference/sync
        const historyPath = path.join(dataRoot, "player_history.json");
        fs.writeFileSync(historyPath, JSON.stringify({ meta: existingHistoryDoc.meta || {}, ...playerHistory }, null, 2)); // Structure might be slightly different in file vs DB data key
         console.log(`Saved to ${historyPath}`);
    }

  } catch (error) {
    console.error(error);
  } finally {
    await client.close();
  }
}

run();
