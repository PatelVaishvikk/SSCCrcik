import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getDb } from "@/lib/mongo";
import { createSessionToken, hashPassword, isAllowedEmail } from "@/lib/auth";
import crypto from "crypto";

export async function POST(request: Request) {
  if (!process.env.JWT_SECRET) {
    return NextResponse.json(
      { error: "JWT_SECRET is not configured on the server." },
      { status: 500 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  if (!isAllowedEmail(email)) {
    return NextResponse.json(
      { error: "Only @suhradsportsclub.ca accounts are allowed." },
      { status: 403 }
    );
  }

  const db = await getDb();
  const users = db.collection("admin_users");

  const existing = await users.findOne({ email });
  if (existing) {
    return NextResponse.json({ error: "Account already exists." }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);
  const userId = crypto.randomUUID();
  const userDoc = {
    user_id: userId,
    name: name || email.split("@")[0],
    email,
    password_hash: passwordHash,
    created_at: new Date(),
  };

  await users.insertOne(userDoc);

  const token = await createSessionToken({
    sub: userId,
    email: userDoc.email,
    name: userDoc.name,
  });

  const cookieStore = await cookies();
  cookieStore.set("ssc_session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });

  return NextResponse.json({
    ok: true,
    user: { name: userDoc.name, email: userDoc.email },
  });
}
