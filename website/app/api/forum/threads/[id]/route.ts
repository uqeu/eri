import { NextResponse } from "next/server";
import { getThread, listReplies } from "@/lib/forum";
import { rateLimit } from "@/lib/rate_limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteParams {
  params: { id: string };
}

export async function GET(
  request: Request,
  { params }: RouteParams,
): Promise<NextResponse> {
  const limited = await rateLimit(request, "forum.threads.get");
  if (limited) return limited;

  const thread = await getThread(params.id);
  if (!thread) {
    return NextResponse.json({ error: "Thread not found." }, { status: 404 });
  }
  const replies = await listReplies(thread.id);
  return NextResponse.json({ thread, replies }, { status: 200 });
}
