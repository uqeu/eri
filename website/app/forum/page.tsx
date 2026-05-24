import Link from "next/link";
import { FooterBig } from "@/components/FooterBig";
import { listThreads, type ThreadSummary } from "@/lib/forum";
import {
  formatHandle,
  formatRelativeTime,
  previewLine,
} from "@/lib/forum-format";
import { NewThreadButton } from "./NewThreadButton";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

export default async function ForumPage(): Promise<React.ReactElement> {
  const threads = await listThreads(PAGE_SIZE);
  const now = Date.now();

  return (
    <main className="min-h-screen bg-ink text-paper">
      <div className="mx-auto max-w-4xl px-6 py-12">
        <div className="flex items-end justify-between gap-4 mb-8">
          <div>
            <h1 className="font-display text-3xl text-paper tracking-tight">
              Forum
            </h1>
            <p className="mt-2 text-[13px] text-paper/60">
              Ask, answer, and trade notes with other eri users.
            </p>
          </div>
          <NewThreadButton />
        </div>

        <div className="border-t border-white/[0.06]">
          {threads.length === 0 ? (
            <EmptyState />
          ) : (
            <ul>
              {threads.map((thread) => (
                <ThreadRow key={thread.id} thread={thread} now={now} />
              ))}
            </ul>
          )}
        </div>
      </div>
      <FooterBig />
    </main>
  );
}

function EmptyState(): React.ReactElement {
  return (
    <div className="py-16 text-center">
      <p className="font-mono text-[12px] uppercase tracking-wider text-paper/40">
        No threads yet
      </p>
      <p className="mt-2 text-[13px] text-paper/60">
        Be the first to start a conversation.
      </p>
    </div>
  );
}

interface ThreadRowProps {
  readonly thread: ThreadSummary;
  readonly now: number;
}

function ThreadRow({ thread, now }: ThreadRowProps): React.ReactElement {
  return (
    <li className="border-b border-white/[0.06] py-5 hover:bg-white/[0.015] transition">
      <Link href={`/forum/${thread.id}`} className="block group">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] text-paper group-hover:text-accent transition truncate">
              {thread.title}
            </h2>
            <p className="mt-1 text-[13px] text-paper/55 line-clamp-1">
              {previewLine(thread.body)}
            </p>
          </div>
          <div className="shrink-0 text-right font-mono text-[11px] text-paper/40">
            <div className="text-paper/60">
              {thread.reply_count}{" "}
              {thread.reply_count === 1 ? "reply" : "replies"}
            </div>
            <div className="mt-1">
              {formatRelativeTime(thread.last_reply_at, now)}
            </div>
          </div>
        </div>
        <div className="mt-2 font-mono text-[11px] text-paper/40">
          @{formatHandle(thread.author_email)}
        </div>
      </Link>
    </li>
  );
}
