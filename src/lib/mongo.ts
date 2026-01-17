import { MongoClient } from "mongodb";

const uri = process.env.MONGO_URL || process.env.MONGODB_URI;
if (!uri) {
  throw new Error("Missing MONGO_URL or MONGODB_URI in environment.");
}

const dbName = process.env.MONGO_DB_NAME || "ssc";

type MongoGlobal = typeof globalThis & {
  _mongoClientPromise?: Promise<MongoClient>;
};

const globalForMongo = globalThis as MongoGlobal;

const clientPromise =
  globalForMongo._mongoClientPromise ??
  new MongoClient(uri, { maxPoolSize: 10 }).connect();

if (!globalForMongo._mongoClientPromise) {
  globalForMongo._mongoClientPromise = clientPromise;
}

export async function getDb() {
  const client = await clientPromise;
  return client.db(dbName);
}
