import { NextResponse } from "next/server";
import { randomBytes, randomInt } from "node:crypto";
import { insertDeviceCodeGrant } from "@/lib/inference/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// RFC 8628 §3.2. The device_code is a high-entropy secret held only by the
// polling client; the user_code is short and entered by a human in a browser.
const DEVICE_CODE_BYTES = 32; // 256-bit secret → ~43 chars base64url
const USER_CODE_LENGTH = 8; // shown to the user, formatted XXXX-XXXX
const TTL_SECONDS = 10 * 60;
const POLL_INTERVAL_SEC = 5; // RFC 8628 §3.5 default
const MAX_COLLISION_RETRIES = 5;

// Crockford base32 minus visually ambiguous I, L, O, U. ~40 bits over 8 chars.
const USER_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function newUserCode(): string {
  let out = "";
  for (let i = 0; i < USER_CODE_LENGTH; i += 1) {
    out += USER_CODE_ALPHABET[randomInt(USER_CODE_ALPHABET.length)];
  }
  return out;
}

function formatUserCode(code: string): string {
  // Display form is hyphenated; the stored/looked-up form is not.
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

function baseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_BASE_URL ??
    process.env.ERI_PUBLIC_URL ??
    "https://www.tryeri.ca"
  );
}

export async function POST(): Promise<NextResponse> {
  const expiresAt = new Date(Date.now() + TTL_SECONDS * 1000);

  // Mint a fresh pair; retry only on the (rare) user_code unique collision.
  let deviceCode = "";
  let userCode = "";
  for (let attempt = 0; ; attempt += 1) {
    deviceCode = randomBytes(DEVICE_CODE_BYTES).toString("base64url");
    userCode = newUserCode();
    try {
      await insertDeviceCodeGrant({
        code: deviceCode,
        user_code: userCode,
        expires_at: expiresAt,
      });
      break;
    } catch (err) {
      if (attempt >= MAX_COLLISION_RETRIES - 1) throw err;
    }
  }

  const formattedUserCode = formatUserCode(userCode);
  const verificationUri = new URL("/auth/device", baseUrl()).toString();
  const verificationUriComplete = new URL(
    `/auth/device?user_code=${encodeURIComponent(formattedUserCode)}`,
    baseUrl(),
  ).toString();

  return NextResponse.json(
    {
      // RFC 8628 device authorization response.
      deviceCode,
      userCode: formattedUserCode,
      verificationUri,
      verificationUriComplete,
      // Back-compat alias for older clients that read `verifyUrl`.
      verifyUrl: verificationUriComplete,
      expiresInSec: TTL_SECONDS,
      pollIntervalSec: POLL_INTERVAL_SEC,
    },
    { status: 200 },
  );
}
