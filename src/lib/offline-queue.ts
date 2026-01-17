type OfflineQueueStatus = "pending" | "failed";

export type OfflineQueueItem = {
  id?: number;
  matchId: string;
  clientId: string;
  clientSeq: number;
  endpoint: string;
  payload: Record<string, any>;
  createdAt: string;
  status: OfflineQueueStatus;
  lastError?: string | null;
};

const DB_NAME = "ssc_offline_scoring";
const DB_VERSION = 1;
const QUEUE_STORE = "queue";
const META_STORE = "meta";
const CLIENT_ID_KEY = "ssc_offline_client_id";

function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function openDb() {
  if (typeof indexedDB === "undefined") {
    throw new Error("IndexedDB is not available.");
  }
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(QUEUE_STORE)) {
      const store = db.createObjectStore(QUEUE_STORE, { keyPath: "id", autoIncrement: true });
      store.createIndex("matchId", "matchId", { unique: false });
      store.createIndex("status", "status", { unique: false });
      store.createIndex("matchId_clientSeq", ["matchId", "clientSeq"], { unique: false });
    }
    if (!db.objectStoreNames.contains(META_STORE)) {
      db.createObjectStore(META_STORE);
    }
  };
  return await requestToPromise(request);
}

export function getClientId() {
  if (typeof window === "undefined") return "server";
  let clientId = window.localStorage.getItem(CLIENT_ID_KEY);
  if (!clientId) {
    clientId = window.crypto?.randomUUID
      ? window.crypto.randomUUID()
      : `client_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    window.localStorage.setItem(CLIENT_ID_KEY, clientId);
  }
  return clientId;
}

export async function getNextClientSeq(matchId: string) {
  const db = await openDb();
  const tx = db.transaction(META_STORE, "readwrite");
  const store = tx.objectStore(META_STORE);
  const key = `seq:${matchId}`;
  const current = await requestToPromise(store.get(key));
  const next = (Number(current) || 0) + 1;
  store.put(next, key);
  await transactionDone(tx);
  return next;
}

export async function enqueueOfflineAction(params: {
  matchId: string;
  endpoint: string;
  payload: Record<string, any>;
  clientId: string;
  clientSeq: number;
}) {
  const db = await openDb();
  const tx = db.transaction(QUEUE_STORE, "readwrite");
  const store = tx.objectStore(QUEUE_STORE);
  const item: OfflineQueueItem = {
    matchId: params.matchId,
    endpoint: params.endpoint,
    payload: params.payload,
    clientId: params.clientId,
    clientSeq: params.clientSeq,
    createdAt: new Date().toISOString(),
    status: "pending",
  };
  const id = await requestToPromise(store.add(item));
  await transactionDone(tx);
  return { ...item, id };
}

export async function listOfflineActions(matchId: string) {
  const db = await openDb();
  const tx = db.transaction(QUEUE_STORE, "readonly");
  const store = tx.objectStore(QUEUE_STORE);
  const index = store.index("matchId");
  const items = await requestToPromise(index.getAll(matchId));
  await transactionDone(tx);
  return (items as OfflineQueueItem[])
    .filter((item) => item.status === "pending" || item.status === "failed")
    .sort((a, b) => (a.clientSeq || 0) - (b.clientSeq || 0));
}

export async function getOfflineCounts(matchId: string) {
  const items = await listOfflineActions(matchId);
  let pending = 0;
  let failed = 0;
  items.forEach((item) => {
    if (item.status === "failed") failed += 1;
    else pending += 1;
  });
  return { pending, failed };
}

export async function updateOfflineAction(id: number, updates: Partial<OfflineQueueItem>) {
  const db = await openDb();
  const tx = db.transaction(QUEUE_STORE, "readwrite");
  const store = tx.objectStore(QUEUE_STORE);
  const existing = await requestToPromise(store.get(id));
  if (!existing) {
    await transactionDone(tx);
    return;
  }
  const next = { ...(existing as OfflineQueueItem), ...updates };
  store.put(next);
  await transactionDone(tx);
}

export async function deleteOfflineAction(id: number) {
  const db = await openDb();
  const tx = db.transaction(QUEUE_STORE, "readwrite");
  const store = tx.objectStore(QUEUE_STORE);
  store.delete(id);
  await transactionDone(tx);
}

export async function resetFailedActions(matchId: string) {
  const items = await listOfflineActions(matchId);
  const failed = items.filter((item) => item.status === "failed");
  if (!failed.length) return;
  const db = await openDb();
  const tx = db.transaction(QUEUE_STORE, "readwrite");
  const store = tx.objectStore(QUEUE_STORE);
  failed.forEach((item) => {
    store.put({ ...item, status: "pending", lastError: null });
  });
  await transactionDone(tx);
}
