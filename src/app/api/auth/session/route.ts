import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/auth";

export async function GET() {
  const token = (await cookies()).get("ssc_session")?.value;
  const session = token ? await verifySessionToken(token) : null;
  return NextResponse.json({ session });
}
