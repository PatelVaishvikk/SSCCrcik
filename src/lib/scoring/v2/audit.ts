import type { Db } from "mongodb";

export type AuditAction =
  | "EVENT_ADDED"
  | "UNDO"
  | "EDIT"
  | "INNINGS_START"
  | "INNINGS_END"
  | "MATCH_END"
  | "MATCH_LOCK"
  | "MATCH_UNLOCK"
  | "ROLE_DENIED";

export async function writeAuditLog(params: {
  db: Db;
  matchId: string;
  userId: string | null;
  action: AuditAction;
  details?: Record<string, any>;
}) {
  const { db, matchId, userId, action, details } = params;
  await db.collection("audit_logs").insertOne({
    match_id: matchId,
    user_id: userId,
    action,
    details: details || null,
    created_at: new Date(),
  });
}
