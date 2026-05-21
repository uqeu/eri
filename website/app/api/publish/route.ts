import { NextResponse } from "next/server";
import {
  isValidSlug,
  writePublished,
  type PublishIntent,
  type PublishIteration,
  type PublishedProject,
} from "../_publish/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ITERATIONS = 500;
const MAX_HTML_BYTES = 512 * 1024;

interface PublishRequestBody {
  slug?: unknown;
  name?: unknown;
  intents?: unknown;
  iterations?: unknown;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseIntents(raw: unknown): PublishIntent[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: PublishIntent[] = [];
  for (const entry of raw) {
    if (entry && typeof entry === "object") {
      const obj = entry as Record<string, unknown>;
      const text = typeof obj.text === "string" ? obj.text : null;
      if (text !== null) {
        out.push({
          text,
          ts: typeof obj.ts === "string" ? obj.ts : undefined,
        });
      }
    } else if (typeof entry === "string") {
      out.push({ text: entry });
    }
  }
  return out;
}

function parseIterations(raw: unknown): PublishIteration[] | { error: string } {
  if (!Array.isArray(raw)) {
    return { error: "iterations must be an array" };
  }
  if (raw.length === 0) {
    return { error: "at least one iteration is required" };
  }
  if (raw.length > MAX_ITERATIONS) {
    return { error: `too many iterations (max ${MAX_ITERATIONS})` };
  }
  const out: PublishIteration[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      return { error: "iteration must be an object" };
    }
    const obj = entry as Record<string, unknown>;
    const n = typeof obj.n === "number" ? Math.floor(obj.n) : null;
    const prompt = typeof obj.prompt === "string" ? obj.prompt : null;
    const html = typeof obj.html === "string" ? obj.html : null;
    const ts = typeof obj.ts === "string" ? obj.ts : null;
    if (n === null || prompt === null || html === null || ts === null) {
      return { error: "iteration requires n, prompt, html, ts" };
    }
    if (Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES) {
      return { error: `iteration ${n} html exceeds ${MAX_HTML_BYTES} bytes` };
    }
    out.push({ n, prompt, html, ts });
  }
  out.sort((a, b) => a.n - b.n);
  return out;
}

export async function POST(request: Request) {
  let payload: PublishRequestBody;
  try {
    payload = (await request.json()) as PublishRequestBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const slug = asString(payload.slug)?.trim().toLowerCase() ?? "";
  if (!isValidSlug(slug)) {
    return NextResponse.json(
      {
        error:
          "Invalid slug. Must be lowercase ASCII alphanumerics or hyphens, 1-64 chars.",
      },
      { status: 400 },
    );
  }

  const iterations = parseIterations(payload.iterations);
  if (!Array.isArray(iterations)) {
    return NextResponse.json({ error: iterations.error }, { status: 400 });
  }

  const intents = parseIntents(payload.intents);
  const name = asString(payload.name)?.trim() || slug;

  const project: PublishedProject = {
    slug,
    name,
    intents,
    iterations,
    publishedAt: new Date().toISOString(),
  };

  try {
    await writePublished(project);
  } catch (error) {
    console.error("publish write failed", error);
    return NextResponse.json(
      { error: "Could not save the project. Try again shortly." },
      { status: 500 },
    );
  }

  const origin = new URL(request.url).origin;
  return NextResponse.json(
    {
      ok: true,
      slug,
      url: `${origin}/p/${slug}`,
      apiUrl: `${origin}/api/p/${slug}`,
    },
    { status: 200 },
  );
}
