"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authedFetch, useUser } from "@/lib/auth-client";

const BODY_MIN = 1;
const BODY_MAX = 5000;

interface ReplyFormProps {
  readonly threadId: string;
}

export function ReplyForm({ threadId }: ReplyFormProps): React.ReactElement {
  const router = useRouter();
  const { user, loading } = useUser();
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) {
    return (
      <p className="font-mono text-[12px] text-paper/40">Loading…</p>
    );
  }

  if (!user) {
    return (
      <p className="text-[13px] text-paper/60">
        <Link
          href={`/sign-in?next=/forum/${threadId}`}
          className="text-accent hover:underline"
        >
          Sign in
        </Link>{" "}
        to reply.
      </p>
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    if (body.length < BODY_MIN || body.length > BODY_MAX) {
      setError(`Reply must be ${BODY_MIN}-${BODY_MAX} characters.`);
      return;
    }
    setSubmitting(true);
    try {
      const response = await authedFetch(
        `/api/forum/threads/${threadId}/replies`,
        {
          method: "POST",
          body: { body },
        },
      );
      if (!response.ok) {
        const fallback = `Failed to post reply (${response.status}).`;
        let message = fallback;
        try {
          const payload: unknown = await response.json();
          if (
            typeof payload === "object" &&
            payload !== null &&
            typeof (payload as { error?: unknown }).error === "string"
          ) {
            message = (payload as { error: string }).error;
          }
        } catch {
          // Keep the fallback message.
        }
        setError(message);
        setSubmitting(false);
        return;
      }
      setBody("");
      setSubmitting(false);
      router.refresh();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to post reply.";
      setError(message);
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={BODY_MAX}
        required
        disabled={submitting}
        rows={5}
        className="w-full bg-bg-2 border border-white/[0.08] rounded-sm px-3 py-2 text-[14px] text-paper placeholder:text-paper/30 focus:border-accent/50 focus:outline-none transition resize-y"
        placeholder="Write a reply…"
      />
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-[10px] text-paper/30">
          {body.length} / {BODY_MAX}
        </span>
        {error ? (
          <span
            role="alert"
            className="font-mono text-[12px] text-red-400/90"
          >
            {error}
          </span>
        ) : null}
        <button
          type="submit"
          disabled={submitting}
          className="btn-primary inline-flex items-center gap-1.5 px-4 py-2 text-[13px] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? "Posting…" : "Post reply"}
        </button>
      </div>
    </form>
  );
}
