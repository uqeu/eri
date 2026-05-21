import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { randomBytes, randomUUID } from "node:crypto";
import {
  getActiveRefreshToken,
  getUserById,
  insertRefreshToken,
  revokeRefreshTokenRow,
  type UserRow,
} from "./db";

const BCRYPT_COST = 12;
const ACCESS_TTL_SECONDS = 60 * 60;
const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30;
const ISSUER = "eri";

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

export interface JwtPayload {
  sub: string;
  email: string;
}

function getSecret(): Uint8Array {
  const value = process.env.JWT_SECRET;
  if (!value || value.length < 16) {
    throw new Error("JWT_SECRET environment variable must be set (>=16 chars)");
  }
  return new TextEncoder().encode(value);
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export async function verifyPassword(
  plain: string,
  hashed: string,
): Promise<boolean> {
  return bcrypt.compare(plain, hashed);
}

export async function signAccessToken(user: UserRow): Promise<{
  token: string;
  expiresAt: number;
}> {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + ACCESS_TTL_SECONDS;
  const token = await new SignJWT({ email: user.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuer(ISSUER)
    .setIssuedAt(now)
    .setExpirationTime(expiresAt)
    .sign(getSecret());
  return { token, expiresAt };
}

export async function verifyAccessToken(
  token: string,
): Promise<JwtPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      issuer: ISSUER,
    });
    if (
      typeof payload.sub !== "string" ||
      typeof payload.email !== "string"
    ) {
      return null;
    }
    return { sub: payload.sub, email: payload.email };
  } catch {
    return null;
  }
}

export async function issueRefreshToken(userId: string): Promise<{
  token: string;
  expiresAt: number;
}> {
  const token = randomBytes(48).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + REFRESH_TTL_SECONDS;
  await insertRefreshToken({
    token,
    user_id: userId,
    expires_at: expiresAt,
    created_at: now,
  });
  return { token, expiresAt };
}

export async function consumeRefreshToken(token: string): Promise<UserRow | null> {
  const row = await getActiveRefreshToken(token);
  if (!row) return null;
  const now = Math.floor(Date.now() / 1000);
  if (row.expires_at <= now) {
    return null;
  }
  await revokeRefreshTokenRow(token);
  return getUserById(row.user_id);
}

export async function revokeRefreshToken(token: string): Promise<void> {
  await revokeRefreshTokenRow(token);
}

export async function issueTokenPair(user: UserRow): Promise<TokenPair> {
  const access = await signAccessToken(user);
  const refresh = await issueRefreshToken(user.id);
  return {
    access_token: access.token,
    refresh_token: refresh.token,
    expires_at: access.expiresAt,
  };
}

export function newUserId(): string {
  return `usr_${randomUUID().replace(/-/g, "")}`;
}

export async function userFromBearer(
  authHeader: string | null,
): Promise<UserRow | null> {
  if (!authHeader) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  if (!match) return null;
  const payload = await verifyAccessToken(match[1]);
  if (!payload) return null;
  return getUserById(payload.sub);
}
