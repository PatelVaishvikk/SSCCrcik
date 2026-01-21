import { MongoClient } from "mongodb";
import fs from "fs";
import path from "path";

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
  console.error("No MongoDB URI");
  process.exit(1);
}

const client = new MongoClient(uri);

async function fixMatch(matchId) {
  await client.connect();
  const db = client.db(process.env.MONGO_DB_NAME || "ssc");
  console.log(`Fixing match ${matchId}...`);

  // Get Match config for team limit
  const match = await db.collection("managed_matches").findOne({ match_id: matchId });
  if (!match) {
      console.error("Match not found in managed_matches");
      return;
  }
  
  // Players per side logic
  const settings = match.settings || {};
  const sizeA = match.squad_a_ids?.length || 0;
  const sizeB = match.squad_b_ids?.length || 0;
  const impliedA = sizeA > 11 ? 11 : (sizeA || 11);
  const impliedB = sizeB > 11 ? 11 : (sizeB || 11);
  const config = {
      teamAId: match.team_a_id,
      teamBId: match.team_b_id,
      playersPerSideA: settings.playersPerSide || impliedA,
      playersPerSideB: settings.playersPerSide || impliedB,
  };

  // Get Innings 2 snapshot
  const snapshotDoc = await db.collection("match_snapshots").findOne({ match_id: matchId, innings_no: 2 });
  if (!snapshotDoc) {
      console.error("No snapshot for innings 2 found");
      return;
  }
  const snapshot = snapshotDoc.snapshot;
  
  // Calculate Result
  const team1Score = snapshot.previousInnings?.runs || 0;
  const team2Score = snapshot.runs;
  const target = snapshot.target || (team1Score + 1);
  
  let winnerId = null;
  let matchResult = "";
  let winType = "";
  let winMargin = 0;

  if (team2Score >= target) {
      // Chased
      winnerId = snapshot.battingTeamId;
      winType = "wickets";
      const playersPerSide = snapshot.battingTeamId === config.teamAId ? config.playersPerSideA : config.playersPerSideB;
      const wicketsLimit = playersPerSide - 1;
      const remainingWickets = Math.max(0, wicketsLimit - snapshot.wickets);
      winMargin = remainingWickets;
      matchResult = `Won by ${winMargin} wickets`;
  } else if (team2Score === team1Score) {
      winType = "tie";
      matchResult = "Match Tied";
  } else {
      // Defended
      winnerId = snapshot.bowlingTeamId;
      winType = "runs";
      winMargin = team1Score - team2Score;
      matchResult = `Won by ${winMargin} runs`;
  }
  
  console.log(`Result: ${matchResult}, Winner: ${winnerId}`);

  // Update Snapshot
  snapshot.status = "COMPLETED";
  snapshot.matchResult = matchResult;
  snapshot.winnerId = winnerId;
  snapshot.winType = winType;
  snapshot.winMargin = winMargin;
  snapshot.pendingAction = "NONE";

  await db.collection("match_snapshots").updateOne(
      { match_id: matchId, innings_no: 2 },
      { $set: { snapshot: snapshot, updated_at: new Date() } }
  );
  console.log("Updated snapshot.");

  // Update Managed Match
  await db.collection("managed_matches").updateOne(
      { match_id: matchId },
      { 
          $set: { 
              status: "completed", 
              result: matchResult,
              winner_id: winnerId,
              updated_at: new Date()
          } 
      }
  );
  console.log("Updated managed_matches.");
}

const matchId = process.argv[2];
if (!matchId) {
    console.error("Provide match ID");
    process.exit(1);
}

fixMatch(matchId)
  .catch(console.error)
  .finally(() => client.close());
