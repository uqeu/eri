import { NextResponse } from "next/server";
import { userFromBearer } from "@/lib/auth";
import { recordTurn, type TurnKind } from "@/lib/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RecordBody {
  kind: TurnKind;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cost_cents?: number | null;
}

const KINDS: ReadonlyArray<TurnKind> = ["voice", "cmdk", "composer"];

function parseOptionalInt(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined; // signal "invalid"
  }
  return Math.floor(value);
}

function parseBody(value: unknown): RecordBody | null {
  if (typeof value !== "object" || value === null) return null;
  const obj = value as Record<string, unknown>;
  const kind = obj.kind;
  if (
    typeof kind !== "string" ||
    !(KINDS as ReadonlyArray<string>).includes(kind)
  ) {
    return null;
  }

  // parseOptionalInt returns `undefined` for both "field absent" AND
  // "field present but invalid"; we need to distinguish them so an explicit
  // bad value (e.g. -1) still rejects the request.
  const inputProvided = "input_tokens" in obj;
  const outputProvided = "output_tokens" in obj;
  const costProvided = "cost_cents" in obj;

  const inputTokens = parseOptionalInt(obj.input_tokens);
  const outputTokens = parseOptionalInt(obj.output_tokens);
  const costCents = parseOptionalInt(obj.cost_cents);

  if (inputProvided && inputTokens === undefined) return null;
  if (outputProvided && outputTokens === undefined) return null;
  if (costProvided && costCents === undefined) return null;

  return {
    kind: kind as TurnKind,
    input_tokens: inputProvided ? inputTokens : undefined,
    output_tokens: outputProvided ? outputTokens : undefined,
    cost_cents: costProvided ? costCents : undefined,
  };
}

export async function POST(request: Request): Promise<NextResponse> {
  const user = await userFromBearer(request.headers.get("authorization"));
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const body = parseBody(raw);
  if (!body) {
    return NextResponse.json(
      { error: "kind must be one of voice|cmdk|composer; token/cost fields must be non-negative integers." },
      { status: 400 },
    );
  }

  // SECURITY: do NOT trust client-supplied token/cost numbers — a user could
  // report 0 (or anything) to corrupt cost/COGS reporting. This endpoint exists
  // only to count free-tier turns (voice/cmdk/composer); each POST is one row,
  // and that server-derived COUNT is the authoritative rate-limit signal. Real
  // token billing flows through the metered inference proxy. The body's
  // token/cost fields are still validated (reject malformed) but discarded.
  void body.input_tokens;
  void body.output_tokens;
  void body.cost_cents;
  await recordTurn({ userId: user.id, kind: body.kind });

  return new NextResponse(null, { status: 204 });
}
