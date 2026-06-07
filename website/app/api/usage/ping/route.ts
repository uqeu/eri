import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import {
  insertUsagePing,
  setUserThresholdEmailAt,
  sumTokensUsedSince,
  type UserRow,
} from "@/lib/db";
import { userFromBearer } from "@/lib/auth";
import { rateLimit } from "@/lib/rate_limit";
import { monthlyLimitForTier } from "@/lib/stripe";
import { sendUsageThresholdEmail } from "@/lib/email";

const THRESHOLD_PERCENT = 80;
const THRESHOLD_DEBOUNCE_SECONDS = 60 * 60 * 24 * 7;

function baseUrl(): string {
  return process.env.NEXT_PUBLIC_BASE_URL ?? "https://www.tryeri.ca";
}

function startOfMonthSeconds(now: Date): number {
  const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  return Math.floor(start.getTime() / 1000);
}

async function currentMonthTokens(userId: string): Promise<number> {
  const monthStart = startOfMonthSeconds(new Date());
  return sumTokensUsedSince(userId, monthStart);
}

async function maybeNotifyThreshold(user: UserRow): Promise<void> {
  const limitMillions = monthlyLimitForTier(user.tier);
  if (limitMillions <= 0) return;
  const limitTokens = limitMillions * 1_000_000;
  const used = await currentMonthTokens(user.id);
  const percentage = (used / limitTokens) * 100;
  if (percentage < THRESHOLD_PERCENT) return;

  const now = Math.floor(Date.now() / 1000);
  if (
    user.last_threshold_email_at &&
    now - user.last_threshold_email_at < THRESHOLD_DEBOUNCE_SECONDS
  ) {
    return;
  }

  await setUserThresholdEmailAt(user.id, now);

  const upgradeUrl = new URL("/billing", baseUrl()).toString();
  await sendUsageThresholdEmail({
    to: user.email,
    percentage,
    upgradeUrl,
  });
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PingBody {
  tokens_used: number;
  cost_usd: number;
  model?: string;
}

function parseBody(value: unknown): PingBody | null {
  if (typeof value !== "object" || value === null) return null;
  const obj = value as Record<string, unknown>;
  if (
    typeof obj.tokens_used !== "number" ||
    !Number.isFinite(obj.tokens_used) ||
    obj.tokens_used < 0
  ) {
    return null;
  }
  if (
    typeof obj.cost_usd !== "number" ||
    !Number.isFinite(obj.cost_usd) ||
    obj.cost_usd < 0
  ) {
    return null;
  }
  const model = typeof obj.model === "string" ? obj.model : undefined;
  return {
    tokens_used: Math.floor(obj.tokens_used),
    cost_usd: obj.cost_usd,
    model,
  };
}

export async function POST(request: Request): Promise<NextResponse> {
  const limited = await rateLimit(request, "usage.ping");
  if (limited) return limited;

  const user = await userFromBearer(request.headers.get("authorization"));
  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized." },
      { status: 401 },
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body." },
      { status: 400 },
    );
  }
  const body = parseBody(raw);
  if (!body) {
    return NextResponse.json(
      { error: "tokens_used and cost_usd are required positive numbers." },
      { status: 400 },
    );
  }

  const id = `usg_${randomUUID().replace(/-/g, "")}`;
  const createdAt = Math.floor(Date.now() / 1000);
  await insertUsagePing({
    id,
    user_id: user.id,
    tokens_used: body.tokens_used,
    cost_usd: body.cost_usd,
    model: body.model ?? null,
    created_at: createdAt,
  });

  await maybeNotifyThreshold(user);

  return NextResponse.json({ ok: true, id }, { status: 200 });
}
