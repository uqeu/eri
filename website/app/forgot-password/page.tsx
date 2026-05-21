"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState<string>("");
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [submitted, setSubmitted] = useState<boolean>(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    try {
      await fetch("/api/auth/password-reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
    } catch {
      // Intentionally ignore errors — we don't leak whether the email exists.
    } finally {
      setSubmitting(false);
      setSubmitted(true);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-md">
        <Link
          href="/"
          className="font-display text-2xl tracking-tight hover:text-accent transition"
        >
          eri
        </Link>
        <h1 className="mt-10 font-display text-4xl tracking-tight">
          Reset your password
        </h1>

        {submitted ? (
          <div className="mt-8 rounded-md border border-white/15 bg-white/5 p-6">
            <p className="text-paper">Check your email.</p>
            <p className="mt-3 text-sm text-muted">
              If an account exists for{" "}
              <span className="text-paper">{email}</span>, you'll receive a
              password reset link shortly.
            </p>
            <Link
              href="/sign-in"
              className="mt-6 inline-block text-sm text-accent hover:underline"
            >
              ← Back to sign in
            </Link>
          </div>
        ) : (
          <>
            <p className="mt-3 text-muted">
              Enter your email and we'll send you a reset link.
            </p>
            <form onSubmit={onSubmit} className="mt-10 flex flex-col gap-5">
              <label className="flex flex-col gap-2">
                <span className="text-xs uppercase tracking-[0.2em] text-muted">
                  Email
                </span>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="bg-transparent border border-white/15 rounded-md px-4 py-3 text-paper focus:border-accent focus:outline-none transition"
                />
              </label>
              <button
                type="submit"
                disabled={submitting}
                className="ship-gradient ship-gradient-hover text-ink font-medium px-6 py-3 rounded-md transition disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {submitting ? "Sending…" : "Send reset link"}
              </button>
            </form>
            <p className="mt-8 text-sm text-muted">
              Remember it?{" "}
              <Link
                href="/sign-in"
                className="text-paper hover:text-accent transition"
              >
                Sign in
              </Link>
            </p>
          </>
        )}
      </div>
    </main>
  );
}
