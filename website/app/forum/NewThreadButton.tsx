"use client";

import Link from "next/link";
import { useUser } from "@/lib/auth-client";

/**
 * Client-side gate for the "New thread" CTA on `/forum`. Server-rendering the
 * gate would require a server-readable session cookie; the existing auth flow
 * keeps the access token in memory + a refresh cookie, so we hydrate the user
 * client-side and swap labels accordingly.
 */
export function NewThreadButton(): React.ReactElement {
  const { user, loading } = useUser();

  if (loading) {
    return (
      <span className="inline-flex items-center px-3.5 py-1.5 text-[13px] text-paper/40 font-mono">
        …
      </span>
    );
  }

  if (!user) {
    return (
      <Link
        href="/sign-in?next=/forum/new"
        className="inline-flex items-center px-3.5 py-1.5 text-[13px] text-paper/70 hover:text-paper border border-white/10 rounded-sm transition"
      >
        Sign in to post
      </Link>
    );
  }

  return (
    <Link
      href="/forum/new"
      className="btn-primary inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[13px]"
    >
      New thread
      <span aria-hidden className="text-[10px]">
        →
      </span>
    </Link>
  );
}
