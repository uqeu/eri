import { NextResponse } from "next/server";
import { authenticateApiBearer } from "@/lib/auth/api_tokens";
import { buildUsageWireForIde } from "@/lib/usage/quota";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Status-bar polling endpoint. The IDE hits this every ~30s to render
 * "Pro · 65% tokens left this month" plus the soft-cap warning ribbon.
 *
 * Auth: API bearer (eri_sk_*). NOT the web JWT — the IDE's only
 * credential is the device-code-issued token.
 *
 * Wire shape: flat camelCase with tier slugs ("pro_plus", not "Pro+"),
 * matching `UsageClient.parseUsage` in the extension. See
 * `lib/usage/quota.ts::buildUsageWireForIde`.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const auth = await authenticateApiBearer(request.headers.get("authorization"));
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const wire = await buildUsageWireForIde(auth.user.id, auth.user.tier);
  return NextResponse.json(wire, { status: 200 });
}
