// GET/POST /api/v1/conversation — the desktop's window into the ONE shared
// conversation (the same thread phone eri reads/writes). This is what makes
// laptop↔phone continuity real: the computer-resident eri appends its turns here
// and can replay recent ones, so eri picks up the same conversation on any
// surface. Authed by the eri_sk_ bearer; gated like memory sync (cloud feature).

import { NextResponse } from "next/server";
import { appendTurns, loadConversation } from "@/lib/agent/conversation";
import { authenticateApiBearer } from "@/lib/auth/api_tokens";
import { featureLocked } from "@/lib/feature_gate";
import { rateLimit } from "@/lib/rate_limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Max turns the desktop may push in one request (keeps a runaway client bounded). */
const MAX_APPEND = 50;

/** GET — recent turns (oldest→newest) for the caller. `?limit=` optional. */
export async function GET(request: Request): Promise<Response> {
  const limited = await rateLimit(request, "conversation.read");
  if (limited) return limited;
  const auth = await authenticateApiBearer(request.headers.get("authorization"));
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit")) || undefined;
  const turns = await loadConversation(auth.user.id, limit);
  return NextResponse.json({ turns });
}

/** POST — append turns. Body: `{ turns: [{ role, content }] }`. */
export async function POST(request: Request): Promise<Response> {
  const limited = await rateLimit(request, "conversation.write");
  if (limited) return limited;
  const auth = await authenticateApiBearer(request.headers.get("authorization"));
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // Same paid gate as Tier-A/B sync — cloud conversation is a cloud-sync feature.
  if (featureLocked(auth.user.tier, "cloudSync")) {
    return NextResponse.json({ error: "tier_locked", required: "starter" }, { status: 402 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const raw = (body as { turns?: unknown })?.turns;
  if (!Array.isArray(raw)) {
    return NextResponse.json({ error: "expected { turns: [...] }" }, { status: 400 });
  }
  const turns = raw
    .filter(
      (t): t is { role: unknown; content: unknown } => typeof t === "object" && t !== null,
    )
    .map((t) => ({
      role: t.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: typeof t.content === "string" ? t.content : "",
    }))
    .filter((t) => t.content.trim().length > 0)
    .slice(0, MAX_APPEND);

  await appendTurns(auth.user.id, turns);
  return NextResponse.json({ ok: true, appended: turns.length });
}
