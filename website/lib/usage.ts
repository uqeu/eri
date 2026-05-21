import { randomUUID } from "node:crypto";
import { sql } from "./db";

export type TurnKind = "voice" | "cmdk" | "composer";

export interface RecordTurnInput {
  userId: string;
  kind: TurnKind;
  inputTokens?: number | null;
  outputTokens?: number | null;
  costCents?: number | null;
}

function toCount(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === "string" ? Number.parseInt(value, 10) : value;
}

/**
 * Rolling counters use Postgres `now()` so the database is the single
 * authority on the window boundary — avoids drift between serverless
 * regions and clock-skewed clients. We use a calendar month here to match
 * the billing layer in `lib/stripe.ts`.
 */
export async function countTurnsThisMonth(userId: string): Promise<number> {
  const rows = await sql()<{ total: string | number }[]>`
    SELECT COUNT(*)::bigint AS total
    FROM usage_turns
    WHERE user_id = ${userId}
      AND created_at >= date_trunc('month', now())
  `;
  return toCount(rows[0]?.total);
}

export async function countTurnsThisWeek(userId: string): Promise<number> {
  const rows = await sql()<{ total: string | number }[]>`
    SELECT COUNT(*)::bigint AS total
    FROM usage_turns
    WHERE user_id = ${userId}
      AND created_at >= now() - interval '7 days'
  `;
  return toCount(rows[0]?.total);
}

export async function countTurnsThisDay(userId: string): Promise<number> {
  const rows = await sql()<{ total: string | number }[]>`
    SELECT COUNT(*)::bigint AS total
    FROM usage_turns
    WHERE user_id = ${userId}
      AND created_at >= now() - interval '1 day'
  `;
  return toCount(rows[0]?.total);
}

export async function countTurnsThisHour(userId: string): Promise<number> {
  const rows = await sql()<{ total: string | number }[]>`
    SELECT COUNT(*)::bigint AS total
    FROM usage_turns
    WHERE user_id = ${userId}
      AND created_at >= now() - interval '1 hour'
  `;
  return toCount(rows[0]?.total);
}

export async function recordTurn(input: RecordTurnInput): Promise<void> {
  const id = `trn_${randomUUID().replace(/-/g, "")}`;
  const inputTokens = input.inputTokens ?? null;
  const outputTokens = input.outputTokens ?? null;
  const costCents = input.costCents ?? null;
  await sql()`
    INSERT INTO usage_turns (id, user_id, kind, input_tokens, output_tokens, cost_cents)
    VALUES (
      ${id},
      ${input.userId},
      ${input.kind},
      ${inputTokens},
      ${outputTokens},
      ${costCents}
    )
  `;
}
