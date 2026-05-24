import { runProxy } from "@/lib/inference/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * OpenAI-shaped chat-completions proxy. The IDE sends an OpenAI body and
 * we forward it to OpenAI's master endpoint. The Anthropic / Google
 * shapes have their own routes below.
 */
export async function POST(request: Request): Promise<Response> {
  return runProxy(request, {
    provider: "openai",
    intent: "chat",
  });
}
