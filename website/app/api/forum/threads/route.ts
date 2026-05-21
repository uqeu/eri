import { NextResponse } from "next/server";
import { userFromBearer } from "@/lib/auth";
import { createThread, listThreads } from "@/lib/forum";
import { rateLimit } from "@/lib/rate_limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

const TITLE_MIN = 3;
const TITLE_MAX = 200;
const BODY_MIN = 1;
const BODY_MAX = 5000;

interface CreateThreadBody {
  title: string;
  body: string;
}

function isCreateThreadBody(value: unknown): value is CreateThreadBody {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.title === "string" && typeof obj.body === "string";
}

function validateTitleAndBody(
  title: string,
  body: string,
): string | null {
  const trimmedTitle = title.trim();
  if (trimmedTitle.length < TITLE_MIN || trimmedTitle.length > TITLE_MAX) {
    return `title must be ${TITLE_MIN}-${TITLE_MAX} characters.`;
  }
  if (body.length < BODY_MIN || body.length > BODY_MAX) {
    return `body must be ${BODY_MIN}-${BODY_MAX} characters.`;
  }
  return null;
}

export async function GET(request: Request): Promise<NextResponse> {
  const limited = rateLimit(request, "forum.threads.list");
  if (limited) return limited;

  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const beforeParam = url.searchParams.get("before");

  const limit = limitParam ? Math.min(
    Math.max(Number.parseInt(limitParam, 10) || DEFAULT_LIMIT, 1),
    MAX_LIMIT,
  ) : DEFAULT_LIMIT;
  const before = beforeParam
    ? Number.parseInt(beforeParam, 10)
    : undefined;
  if (beforeParam && (before === undefined || Number.isNaN(before))) {
    return NextResponse.json(
      { error: "Invalid 'before' cursor." },
      { status: 400 },
    );
  }

  const threads = await listThreads(limit, before);
  return NextResponse.json({ threads }, { status: 200 });
}

export async function POST(request: Request): Promise<NextResponse> {
  const limited = rateLimit(request, "forum.threads.create");
  if (limited) return limited;

  const user = await userFromBearer(request.headers.get("authorization"));
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  if (!isCreateThreadBody(parsed)) {
    return NextResponse.json(
      { error: "Body must include string 'title' and 'body'." },
      { status: 400 },
    );
  }
  const validationError = validateTitleAndBody(parsed.title, parsed.body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const thread = await createThread({
    userId: user.id,
    title: parsed.title.trim(),
    body: parsed.body,
  });
  return NextResponse.json({ thread }, { status: 201 });
}
