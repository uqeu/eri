"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { setSession, type AuthSuccessResponse } from "@/lib/auth-client";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";

function isAuthSuccess(value: unknown): value is AuthSuccessResponse {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.access_token === "string" &&
    typeof obj.refresh_token === "string" &&
    typeof obj.expires_at === "number"
  );
}

function errorMessage(value: unknown): string {
  if (typeof value === "object" && value !== null) {
    const err = (value as { error?: unknown }).error;
    if (typeof err === "string") return err;
  }
  return "Sign-in failed. Try again.";
}

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body: unknown = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(errorMessage(body));
        return;
      }
      if (!isAuthSuccess(body)) {
        setError("Unexpected server response.");
        return;
      }
      setSession(body);
      router.push("/dashboard");
    } catch {
      setError("Network error. Try again.");
    } finally {
      setSubmitting(false);
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
          Welcome back
        </h1>
        <p className="mt-3 text-muted">Sign in to your eri account.</p>

        <div className="mt-10">
          <GoogleSignInButton label="Sign in with Google" />
        </div>

        <div className="my-8 flex items-center gap-4 text-xs uppercase tracking-[0.2em] text-muted">
          <span className="h-px flex-1 bg-white/10" />
          <span>or</span>
          <span className="h-px flex-1 bg-white/10" />
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-5">
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
          <label className="flex flex-col gap-2">
            <span className="text-xs uppercase tracking-[0.2em] text-muted">
              Password
            </span>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="bg-transparent border border-white/15 rounded-md px-4 py-3 text-paper focus:border-accent focus:outline-none transition"
            />
          </label>

          {error && (
            <p className="text-sm text-red-400" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="ship-gradient ship-gradient-hover text-ink font-medium px-6 py-3 rounded-md transition disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <div className="mt-8 flex items-center justify-between text-sm text-muted">
          <Link href="/forgot-password" className="hover:text-paper transition">
            Forgot password?
          </Link>
          <Link href="/sign-up" className="hover:text-paper transition">
            Create an account →
          </Link>
        </div>
      </div>
    </main>
  );
}
