import { runProxy } from "@/lib/inference/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Google `generateContent` proxy. The model id is part of the path on
 * Google's side, so we derive the URL from the request body's `model`
 * field. Body is forwarded verbatim.
 */
export async function POST(request: Request): Promise<Response> {
  return runProxy(request, {
    provider: "google",
    intent: "chat",
    upstreamUrl: (body) => {
      const model =
        typeof body === "object" && body !== null
          ? ((body as Record<string, unknown>).model as string | undefined)
          : undefined;
      const action =
        typeof body === "object" && body !== null
          ? ((body as Record<string, unknown>).stream === true
              ? "streamGenerateContent"
              : "generateContent")
          : "generateContent";
      const safeModel = model && model.length > 0 ? model : "gemini-2.5-flash";
      return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(safeModel)}:${action}`;
    },
  });
}
