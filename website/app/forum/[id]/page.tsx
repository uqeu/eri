import Link from "next/link";
import { notFound } from "next/navigation";
import { FooterBig } from "@/components/FooterBig";
import {
  getThread,
  listReplies,
  type Reply,
  type Thread,
} from "@/lib/forum";
import { formatHandle, formatRelativeTime } from "@/lib/forum-format";
import { ReplyForm } from "./ReplyForm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PageProps {
  params: { id: string };
}

export default async function ThreadPage({
  params,
}: PageProps): Promise<React.ReactElement> {
  const thread = await getThread(params.id);
  if (!thread) {
    notFound();
  }
  const replies = await listReplies(thread.id);
  const now = Date.now();

  return (
    <main className="min-h-screen bg-ink text-paper">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <Link
          href="/forum"
          className="font-mono text-[11px] uppercase tracking-wider text-paper/40 hover:text-paper/70 transition"
        >
          ← Forum
        </Link>

        <ThreadHeader thread={thread} now={now} />

        <section className="mt-10">
          <h2 className="font-mono text-[11px] uppercase tracking-wider text-paper/50 mb-4">
            {replies.length} {replies.length === 1 ? "reply" : "replies"}
          </h2>
          {replies.length === 0 ? (
            <p className="text-[13px] text-paper/40">
              No replies yet. Be the first.
            </p>
          ) : (
            <ul className="space-y-6">
              {replies.map((reply) => (
                <ReplyRow key={reply.id} reply={reply} now={now} />
              ))}
            </ul>
          )}
        </section>

        <section className="mt-10 border-t border-white/[0.06] pt-8">
          <h2 className="font-mono text-[11px] uppercase tracking-wider text-paper/50 mb-4">
            Your reply
          </h2>
          <ReplyForm threadId={thread.id} />
        </section>
      </div>
      <FooterBig />
    </main>
  );
}

interface ThreadHeaderProps {
  readonly thread: Thread;
  readonly now: number;
}

function ThreadHeader({
  thread,
  now,
}: ThreadHeaderProps): React.ReactElement {
  return (
    <article className="mt-3">
      <h1 className="font-display text-3xl text-paper tracking-tight">
        {thread.title}
      </h1>
      <div className="mt-3 font-mono text-[11px] text-paper/40 flex items-center gap-3">
        <span>@{formatHandle(thread.author_email)}</span>
        <span aria-hidden>·</span>
        <span>{formatRelativeTime(thread.created_at, now)}</span>
      </div>
      <div className="mt-6 whitespace-pre-wrap text-[14px] leading-relaxed text-paper/85">
        {thread.body}
      </div>
    </article>
  );
}

interface ReplyRowProps {
  readonly reply: Reply;
  readonly now: number;
}

function ReplyRow({ reply, now }: ReplyRowProps): React.ReactElement {
  return (
    <li className="border-l border-white/[0.08] pl-4">
      <div className="font-mono text-[11px] text-paper/40 flex items-center gap-3">
        <span>@{formatHandle(reply.author_email)}</span>
        <span aria-hidden>·</span>
        <span>{formatRelativeTime(reply.created_at, now)}</span>
      </div>
      <div className="mt-2 whitespace-pre-wrap text-[14px] leading-relaxed text-paper/85">
        {reply.body}
      </div>
    </li>
  );
}
