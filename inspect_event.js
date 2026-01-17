
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
const client = new MongoClient(uri);

async function run() {
  try {
    await client.connect();
    const db = client.db(process.env.MONGO_DB_NAME || "ssc");
    const event = await db.collection("events").findOne({});
    console.log(JSON.stringify(event, null, 2));
  } catch (e) {
    console.error(e);
  } finally {
    await client.close();
  }
}

run();
