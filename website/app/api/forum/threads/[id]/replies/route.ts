import { NextResponse } from "next/server";
import { userFromBearer } from "@/lib/auth";
import { createReply, getThread } from "@/lib/forum";
import { rateLimit } from "@/lib/rate_limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BODY_MIN = 1;
const BODY_MAX = 5000;

interface CreateReplyBody {
  body: string;
}

function isCreateReplyBody(value: unknown): value is CreateReplyBody {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.body === "string";
}

interface RouteParams {
  params: { id: string };
}

export async function POST(
  request: Request,
  { params }: RouteParams,
): Promise<NextResponse> {
  const limited = await rateLimit(request, "forum.replies.create");
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
  if (!isCreateReplyBody(parsed)) {
    return NextResponse.json(
      { error: "Body must include string 'body'." },
      { status: 400 },
    );
  }
  if (parsed.body.length < BODY_MIN || parsed.body.length > BODY_MAX) {
    return NextResponse.json(
      { error: `body must be ${BODY_MIN}-${BODY_MAX} characters.` },
      { status: 400 },
    );
  }

  const thread = await getThread(params.id);
  if (!thread) {
    return NextResponse.json({ error: "Thread not found." }, { status: 404 });
  }

  const reply = await createReply({
    userId: user.id,
    threadId: thread.id,
    body: parsed.body,
  });
  return NextResponse.json({ reply }, { status: 201 });
}
