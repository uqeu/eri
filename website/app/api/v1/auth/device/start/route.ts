import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { insertDeviceCodeGrant } from "@/lib/inference/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CODE_BYTES = 24; // → 32 chars base64url
const TTL_SECONDS = 10 * 60;

function baseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_BASE_URL ??
    process.env.ERI_PUBLIC_URL ??
    "https://eri.dev"
  );
}

export async function POST(): Promise<NextResponse> {
  const code = randomBytes(CODE_BYTES).toString("base64url");
  const expiresAt = new Date(Date.now() + TTL_SECONDS * 1000);
  await insertDeviceCodeGrant({ code, expires_at: expiresAt });

  const verifyUrl = new URL(`/auth/device?code=${encodeURIComponent(code)}`, baseUrl()).toString();
  return NextResponse.json(
    {
      code,
      verifyUrl,
      expiresInSec: TTL_SECONDS,
      pollIntervalSec: 2,
    },
    { status: 200 },
  );
}
