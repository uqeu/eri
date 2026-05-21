"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterBig } from "@/components/FooterBig";
import { authedFetch } from "@/lib/auth-client";

const TITLE_MIN = 3;
const TITLE_MAX = 200;
const BODY_MIN = 1;
const BODY_MAX = 5000;

interface CreateThreadResponse {
  thread: { id: string };
}

function isCreateThreadResponse(value: unknown): value is CreateThreadResponse {
  if (typeof value !== "object" || value === null) return false;
  const thread = (value as { thread?: unknown }).thread;
  if (typeof thread !== "object" || thread === null) return false;
  return typeof (thread as { id?: unknown }).id === "string";
}

export default function NewThreadPage(): React.ReactElement {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function validate(): string | null {
    const trimmed = title.trim();
    if (trimmed.length < TITLE_MIN || trimmed.length > TITLE_MAX) {
      return `Title must be ${TITLE_MIN}-${TITLE_MAX} characters.`;
    }
    if (body.length < BODY_MIN || body.length > BODY_MAX) {
      return `Body must be ${BODY_MIN}-${BODY_MAX} characters.`;
    }
    return null;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setSubmitting(true);
    try {
      const response = await authedFetch("/api/forum/threads", {
        method: "POST",
        body: { title: title.trim(), body },
      });
      if (!response.ok) {
        const fallback = `Failed to post (${response.status}).`;
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
      const payload: unknown = await response.json();
      if (!isCreateThreadResponse(payload)) {
        setError("Unexpected response from server.");
        setSubmitting(false);
        return;
      }
      router.push(`/forum/${payload.thread.id}`);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to post thread.";
      setError(message);
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-ink text-paper">
      <SiteHeader variant="solid" />
      <div className="mx-auto max-w-2xl px-6 py-12">
        <Link
          href="/forum"
          className="font-mono text-[11px] uppercase tracking-wider text-paper/40 hover:text-paper/70 transition"
        >
          ← Forum
        </Link>
        <h1 className="mt-3 font-display text-3xl text-paper tracking-tight">
          New thread
        </h1>

        <form onSubmit={onSubmit} className="mt-8 space-y-5">
          <div>
            <label
              htmlFor="title"
              className="block font-mono text-[11px] uppercase tracking-wider text-paper/50 mb-2"
            >
              Title
            </label>
            <input
              id="title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={TITLE_MAX}
              required
              disabled={submitting}
              className="w-full bg-bg-2 border border-white/[0.08] rounded-sm px-3 py-2 text-[14px] text-paper placeholder:text-paper/30 focus:border-accent/50 focus:outline-none transition"
              placeholder="What do you want to talk about?"
            />
          </div>

          <div>
            <label
              htmlFor="body"
              className="block font-mono text-[11px] uppercase tracking-wider text-paper/50 mb-2"
            >
              Body
            </label>
            <textarea
              id="body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={BODY_MAX}
              required
              disabled={submitting}
              rows={10}
              className="w-full bg-bg-2 border border-white/[0.08] rounded-sm px-3 py-2 text-[14px] text-paper placeholder:text-paper/30 focus:border-accent/50 focus:outline-none transition resize-y"
              placeholder="Share the context…"
            />
            <div className="mt-1 text-right font-mono text-[10px] text-paper/30">
              {body.length} / {BODY_MAX}
            </div>
          </div>

          {error ? (
            <p
              role="alert"
              className="font-mono text-[12px] text-red-400/90 border border-red-400/20 bg-red-400/5 px-3 py-2 rounded-sm"
            >
              {error}
            </p>
          ) : null}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={submitting}
              className="btn-primary inline-flex items-center gap-1.5 px-4 py-2 text-[13px] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? "Posting…" : "Post thread"}
            </button>
            <Link
              href="/forum"
              className="text-[13px] text-paper/60 hover:text-paper transition"
            >
              Cancel
            </Link>
          </div>
        </form>
      </div>
      <FooterBig />
    </main>
  );
}
