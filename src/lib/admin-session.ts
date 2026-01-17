import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/auth";

export async function getAdminSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("ssc_session")?.value;
  console.log("[AuthDebug] Token present:", !!token);
  if (!token) return null;
  const session = await verifySessionToken(token);
  console.log("[AuthDebug] Session valid:", !!session);
  return session;
}
