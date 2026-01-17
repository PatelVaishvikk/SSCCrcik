import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";

const adminDomain = (process.env.ADMIN_EMAIL_DOMAIN || "suhradsportsclub.ca").toLowerCase();
let cachedSecretKey: Uint8Array | null = null;

function getSecretKey() {
  if (cachedSecretKey) return cachedSecretKey;
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error("Missing JWT_SECRET in environment.");
  }
  cachedSecretKey = new TextEncoder().encode(jwtSecret);
  return cachedSecretKey;
}

export type SessionPayload = {
  sub: string;
  email: string;
  name?: string;
};

export function isAllowedEmail(email: string) {
  const normalized = email.toLowerCase().trim();
  return normalized.endsWith(`@${adminDomain}`);
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function createSessionToken(payload: SessionPayload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getSecretKey());
}

export async function verifySessionToken(token: string) {
  if (!process.env.JWT_SECRET) return null;
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    return payload as SessionPayload;
  } catch {
    return null;
  }
}
