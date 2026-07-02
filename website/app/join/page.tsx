"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { authedFetch, setSession } from "@/lib/auth-client";

/**
 * Magic sign-up link landing. A stranger texted eri, got a link, and tapped it.
 * We claim the token (which binds ONLY their number, hijack-proof): if they're
 * already signed in it links immediately; otherwise they sign up, then link, then
 * land on /onboarding to watch eri start learning their world.
 */

type Phase = "loading" | "signup" | "linking" | "done" | "taken" | "expired" | "notoken";

export default function JoinPage(): ReactNode {
  const [phase, setPhase] = useState<Phase>("loading");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const token = useRef<string>("");

  const claim = useCallback(async (): Promise<void> => {
    setPhase("linking");
    const res = await authedFetch("/api/v1/phone/claim", { method: "POST", body: { token: token.current } });
    if (res.ok) {
      setPhase("done");
      window.setTimeout(() => { window.location.href = "/onboarding"; }, 1400);
      return;
    }
    if (res.status === 409) return setPhase("taken");
    if (res.status === 401) return setPhase("signup");
    setPhase("expired");
  }, []);

  useEffect(() => {
    const t = new URL(window.location.href).searchParams.get("t");
    if (!t) return setPhase("notoken");
    token.current = t;
    // If already signed in (refresh cookie), this links immediately; else → signup.
    void claim();
  }, [claim]);

  async function onSignup(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setErr(body.error === "email_taken" ? "That email already has an account — sign in first." : "Couldn't create your account. Try again.");
        return;
      }
      setSession(await res.json());
      await claim();
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="theme-light flex min-h-screen items-center justify-center bg-bg px-5 py-16 text-text font-geist">
      <div className="w-full max-w-md rounded-2xl border border-border bg-bg-card p-7">
        <h1 className="font-display text-[26px] font-600 tracking-[-0.02em] text-text">
          {phase === "signup" ? "Set up eri" : "eri"}
        </h1>

        {(phase === "loading" || phase === "linking") && (
          <p className="mt-3 text-[13.5px] text-text-sec">
            <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-green-600" />
            Linking this number to your account…
          </p>
        )}

        {phase === "done" && (
          <p className="mt-3 text-[13.5px] text-text-sec">Linked ✓ — taking you to your world…</p>
        )}

        {phase === "signup" && (
          <>
            <p className="mt-2 text-[13.5px] leading-relaxed text-text-sec">
              Create your account and I&apos;ll link it to the number you texted from. It stays yours — no one else can claim it.
            </p>
            <form onSubmit={onSignup} className="mt-5 flex flex-col gap-3">
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@email.com"
                className="w-full rounded-xl border border-border bg-bg-card px-4 py-2.5 text-[14px] text-text placeholder:text-text-ter focus:border-[rgba(40,33,22,0.22)] focus:outline-none"
              />
              <input
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password (8+ characters)"
                className="w-full rounded-xl border border-border bg-bg-card px-4 py-2.5 text-[14px] text-text placeholder:text-text-ter focus:border-[rgba(40,33,22,0.22)] focus:outline-none"
              />
              {err && <p className="text-[12.5px] text-red-600">{err}</p>}
              <button
                type="submit"
                disabled={busy}
                className="mt-1 rounded-full border border-border bg-bg-card px-4 py-2.5 text-[14px] text-text transition-colors hover:border-[rgba(40,33,22,0.22)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? "Setting up…" : "Create account & link"}
              </button>
            </form>
          </>
        )}

        {phase === "taken" && (
          <p className="mt-3 text-[13.5px] leading-relaxed text-text-sec">
            This number is already linked to an eri account. If it&apos;s yours, sign in — for security, a number can only belong to one account.
          </p>
        )}

        {phase === "expired" && (
          <p className="mt-3 text-[13.5px] leading-relaxed text-text-sec">
            This link expired or was already used. Text eri again and I&apos;ll send a fresh one 🌿
          </p>
        )}

        {phase === "notoken" && (
          <p className="mt-3 text-[13.5px] text-text-sec">This link is missing its code. Text eri again for a new one.</p>
        )}
      </div>
    </main>
  );
}
