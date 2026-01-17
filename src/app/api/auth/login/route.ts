import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getDb } from "@/lib/mongo";
import { createSessionToken, isAllowedEmail, verifyPassword } from "@/lib/auth";

export async function POST(request: Request) {
  if (!process.env.JWT_SECRET) {
    return NextResponse.json(
      { error: "JWT_SECRET is not configured on the server." },
      { status: 500 }
    );
  }

  const body = await request.json().catch(() => ({}));
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

  const user = await users.findOne({ email });
  if (!user) {
    return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
  }

  const token = await createSessionToken({
    sub: String(user.user_id || user._id),
    email: user.email,
    name: user.name,
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
    user: { name: user.name, email: user.email },
  });
}
