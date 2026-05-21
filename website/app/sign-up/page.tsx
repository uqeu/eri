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
  return "Sign-up failed. Try again.";
}

export default function SignUpPage() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          display_name: displayName || undefined,
        }),
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
    <main className="min-h-screen flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-md">
        <Link
          href="/"
          className="font-display text-2xl tracking-tight hover:text-accent transition"
        >
          eri
        </Link>
        <h1 className="mt-10 font-display text-4xl tracking-tight">
          Create your account
        </h1>
        <p className="mt-3 text-muted">
          Get started with eri. Free tier — no card required.
        </p>

        <div className="mt-10">
          <GoogleSignInButton label="Continue with Google" />
        </div>

        <div className="my-8 flex items-center gap-4 text-xs uppercase tracking-[0.2em] text-muted">
          <span className="h-px flex-1 bg-white/10" />
          <span>or</span>
          <span className="h-px flex-1 bg-white/10" />
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-5">
          <label className="flex flex-col gap-2">
            <span className="text-xs uppercase tracking-[0.2em] text-muted">
              Display name
            </span>
            <input
              type="text"
              autoComplete="name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="bg-transparent border border-white/15 rounded-md px-4 py-3 text-paper focus:border-accent focus:outline-none transition"
            />
          </label>
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
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="bg-transparent border border-white/15 rounded-md px-4 py-3 text-paper focus:border-accent focus:outline-none transition"
            />
            <span className="text-xs text-muted">At least 8 characters.</span>
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
            {submitting ? "Creating account…" : "Create account"}
          </button>
        </form>

        <p className="mt-8 text-sm text-muted">
          Already have an account?{" "}
          <Link href="/sign-in" className="text-paper hover:text-accent transition">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
