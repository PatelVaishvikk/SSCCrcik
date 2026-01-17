import type { Db } from "mongodb";
import type { MatchSnapshot } from "@/lib/scoring/v2/types";

type ClientSequenceResult = {
  error: string;
  lastSeq?: number;
};

type VersionResult = {
  error: string;
  expectedVersion: number;
  currentVersion: number;
};

export function validateExpectedVersion(
  snapshot: MatchSnapshot | null,
  expectedVersion?: number | null
): VersionResult | null {
  if (expectedVersion === undefined || expectedVersion === null) return null;
  const currentVersion = snapshot?.version ?? 0;
  if (currentVersion !== expectedVersion) {
    return {
      error: "Snapshot out of sync.",
      expectedVersion,
      currentVersion,
    };
  }
  return null;
}

export async function validateClientSequence(params: {
  db: Db;
  matchId: string;
  clientId?: string | null;
  clientSeq?: number | null;
}): Promise<ClientSequenceResult | null> {
  const clientId = params.clientId ? String(params.clientId) : "";
  const clientSeq = Number(params.clientSeq);
  if (!clientId || !Number.isFinite(clientSeq)) return null;
  const doc = await params.db
    .collection("match_client_sequences")
    .findOne({ match_id: params.matchId, client_id: clientId });
  const lastSeq = Number(doc?.last_seq ?? 0);
  if (clientSeq <= lastSeq) {
    return { error: "Client sequence out of order.", lastSeq };
  }
  return null;
}

export async function commitClientSequence(params: {
  db: Db;
  matchId: string;
  clientId?: string | null;
  clientSeq?: number | null;
}) {
  const clientId = params.clientId ? String(params.clientId) : "";
  const clientSeq = Number(params.clientSeq);
  if (!clientId || !Number.isFinite(clientSeq)) return;
  const now = new Date();
  await params.db.collection("match_client_sequences").updateOne(
    { match_id: params.matchId, client_id: clientId },
    {
      $max: { last_seq: clientSeq },
      $set: { updated_at: now },
      $setOnInsert: { match_id: params.matchId, client_id: clientId, created_at: now },
    },
    { upsert: true }
  );
}
