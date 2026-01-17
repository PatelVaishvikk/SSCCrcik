import type { Db } from "mongodb";
import type { MatchRole, MatchSnapshot } from "@/lib/scoring/v2/types";
import { computeAllowedActions } from "@/lib/scoring/v2/permissions";

export type UserIdentity = {
  id: string;
  name: string;
  email?: string;
};

export async function getUserById(db: Db, userId: string) {
  const user = await db.collection("admin_users").findOne({ user_id: userId });
  if (!user) return null;
  return {
    id: user.user_id,
    name: user.name || user.email || "Admin",
    email: user.email,
  } as UserIdentity;
}

export async function resolveMatchRole(
  db: Db,
  matchId: string,
  userId?: string | null
): Promise<{ role: MatchRole; user: UserIdentity | null }> {
  if (!userId) return { role: "VIEWER", user: null };

  const user = await getUserById(db, userId);
  const roleDoc = await db
    .collection("match_roles")
    .findOne({ match_id: matchId, user_id: userId });

  if (roleDoc?.role) {
    return { role: String(roleDoc.role).toUpperCase() as MatchRole, user };
  }

  if (user) {
    return { role: "ADMIN", user };
  }

  return { role: "VIEWER", user: null };
}

export function buildAllowedActions(snapshot: MatchSnapshot, role: MatchRole) {
  return computeAllowedActions(snapshot, role);
}

export function hasRolePermission(role: MatchRole, action: "score" | "manage") {
  if (action === "score") {
    return role === "ADMIN" || role === "ORGANIZER" || role === "SCORER";
  }
  return role === "ADMIN" || role === "ORGANIZER";
}
