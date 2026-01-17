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
const PLAYER_IMG_DIR = path.join(PUBLIC_DIR, "player-images");

if (!fs.existsSync(PLAYER_IMG_DIR)) {
  fs.mkdirSync(PLAYER_IMG_DIR, { recursive: true });
}

async function downloadImage(url, dest) {
  if (fs.existsSync(dest)) return true; // Already downloaded

  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        // console.error(`Failed to download ${url}: ${response.statusCode}`);
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
      resolve(false);
    });
  });
}

async function run() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  console.log("Reading GLOBAL_PLAYER_DATABASE.json...");
  // Assuming the file is in the root or same level as data_* folders
  const globalDbPath = path.resolve(process.cwd(), "../GLOBAL_PLAYER_DATABASE.json");
  
  if (!fs.existsSync(globalDbPath)) {
      console.error(`Could not find ${globalDbPath}`);
      return;
  }
  
  const content = fs.readFileSync(globalDbPath, "utf8");
  const data = JSON.parse(content);
  const players = data.players || {};
  
  const playerMap = Object.values(players);
  console.log(`Found ${playerMap.length} players locally.`);
  
  let downloadedCount = 0;
  const updates = new Map(); // player_id -> local_path

  for (const player of playerMap) {
      const pid = player.player_id;
      const url = player.profile?.profile_photo;
      
      if (url && url.startsWith("http")) {
          const filename = path.basename(url).split('?')[0];
          if (filename && (filename.endsWith('.jpg') || filename.endsWith('.jpeg') || filename.endsWith('.png'))) {
              const dest = path.join(PLAYER_IMG_DIR, filename);
              const success = await downloadImage(url, dest);
              if (success) {
                  downloadedCount++;
                  updates.set(String(pid), `/player-images/${filename}`);
              }
          }
      }
  }

  console.log(`Downloaded ${downloadedCount} player images.`);

  // Update DB
  // Players might be scattered in multiple collections or a central one.
  // Viewing seed-db.mjs earlier suggested there might be a 'meta' or 'players' collection?
  // Actually, seed-db uses `meta` collection for GLOBAL_PLAYER_DATABASE or individual `search_players`?
  // Let's check `search_players` first as it's used for directory.
  
  console.log("Updating search_players collection...");
  const searchPlayers = await db.collection("search_players").find({}).toArray();
  let updatedSearch = 0;
  
  for (const sp of searchPlayers) {
      const localPath = updates.get(String(sp.id)); // search_players likely uses 'id' not 'player_id' based on typical mapping
      if (localPath && sp.photo !== localPath) {
          await db.collection("search_players").updateOne(
              { _id: sp._id },
              { $set: { photo: localPath } }
          );
          updatedSearch++;
      }
  }
  console.log(`Updated ${updatedSearch} search_players.`);

  // If there is a central meta document for players
  // NOTE: If the app reads mainly from `search_players` (PlayerDirectory.tsx does), this might be enough.
  // But let's check if there's a big blob in `meta` collection too.
  
  await client.close();
}

run().catch(console.error);
