import { runProxy } from "@/lib/inference/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Anthropic-shaped `/v1/messages` proxy.
 */
export async function POST(request: Request): Promise<Response> {
  return runProxy(request, {
    provider: "anthropic",
    intent: "chat",
  });
}
