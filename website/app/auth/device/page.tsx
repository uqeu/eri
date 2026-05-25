"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { authedFetch, useUser } from "@/lib/auth-client";

type Action = "approve" | "deny";
type Status = "idle" | "submitting" | "done" | "error";

function Shell({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <main className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">{children}</div>
    </main>
  );
}

function Card({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="rounded-2xl border border-border bg-[var(--bg-card)] p-8 shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_12px_40px_-12px_rgba(0,0,0,0.6)]">
      {children}
    </div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
      {children}
    </p>
  );
}

function CodeChip({ code }: { code: string }): JSX.Element {
  // Show only a short slug — the full opaque code in the URL is not
  // user-actionable. Use it just to disambiguate concurrent device flows.
  const short = code.length > 12 ? `${code.slice(0, 6)}…${code.slice(-4)}` : code;
  return (
    <div className="mt-6 rounded-lg border border-border bg-[var(--bg-card-2)] px-4 py-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
        Device code
      </p>
      <p className="mt-1 font-mono text-sm text-text">{short}</p>
    </div>
  );
}

function DevicePageInner(): JSX.Element {
  const search = useSearchParams();
  const code = search.get("code") ?? "";
  const { user, loading } = useUser();
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<Action | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleAction(action: Action): Promise<void> {
    if (!code || status === "submitting") return;
    setStatus("submitting");
    setErrorMessage(null);
    try {
      const response = await authedFetch("/api/v1/auth/device/approve", {
        method: "POST",
        body: { code, action },
      });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        const message =
          typeof body === "object" &&
          body !== null &&
          typeof (body as { error?: unknown }).error === "string"
            ? (body as { error: string }).error
            : `Request failed (${response.status}).`;
        setErrorMessage(message);
        setStatus("error");
        return;
      }
      setResult(action);
      setStatus("done");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Network error.";
      setErrorMessage(message);
      setStatus("error");
    }
  }

  // ───────────── Missing code ─────────────
  if (!code) {
    return (
      <Shell>
        <Card>
          <Eyebrow>Authorize a device</Eyebrow>
          <h1 className="text-2xl font-medium text-text">Code missing</h1>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            This page must be opened with a device code in the URL. Re-run the
            sign-in command from your eri IDE — it'll send you back with the
            right link.
          </p>
        </Card>
      </Shell>
    );
  }

  // ───────────── Loading ─────────────
  if (loading) {
    return (
      <Shell>
        <Card>
          <Eyebrow>Authorize a device</Eyebrow>
          <h1 className="text-2xl font-medium text-text">Checking your session…</h1>
          <p className="mt-3 text-sm text-muted">One moment.</p>
        </Card>
      </Shell>
    );
  }

  // ───────────── Signed out ─────────────
  if (!user) {
    return (
      <Shell>
        <Card>
          <Eyebrow>Authorize a device</Eyebrow>
          <h1 className="text-2xl font-medium text-text">Sign in to continue</h1>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            An eri IDE is asking to connect. Sign in first — your code stays in
            the URL, so we'll bring you right back here.
          </p>
          <Link
            href={`/sign-in?next=${encodeURIComponent(`/auth/device?code=${code}`)}`}
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-bg transition-colors hover:bg-[var(--accent-bright)]"
          >
            Sign in <span aria-hidden>→</span>
          </Link>
          <CodeChip code={code} />
        </Card>
      </Shell>
    );
  }

  // ───────────── Approved / Denied ─────────────
  if (status === "done" && result !== null) {
    const approved = result === "approve";
    return (
      <Shell>
        <Card>
          <Eyebrow>{approved ? "Device connected" : "Request denied"}</Eyebrow>
          <h1 className="text-2xl font-medium text-text">
            {approved ? "You're in." : "No token issued."}
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            {approved
              ? "Return to your eri IDE — it'll pick up the session within a few seconds."
              : "Nothing was sent to the device. You can close this page."}
          </p>
          {approved && (
            <div className="mt-6 rounded-lg border border-[var(--accent-muted)] bg-[var(--accent-faint)] px-4 py-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-accent">
                Signed in as
              </p>
              <p className="mt-1 text-sm text-text">{user.email}</p>
            </div>
          )}
        </Card>
      </Shell>
    );
  }

  // ───────────── Approve / Deny ─────────────
  return (
    <Shell>
      <Card>
        <Eyebrow>Authorize this device</Eyebrow>
        <h1 className="text-2xl font-medium text-text">
          Connect your IDE
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          An eri IDE is asking to sign in as{" "}
          <span className="text-text">{user.email}</span>. Only approve if you
          just started this from your own IDE — the device will be able to use
          your tier quota until you revoke it.
        </p>

        <CodeChip code={code} />

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            disabled={status === "submitting"}
            onClick={() => void handleAction("approve")}
            className="inline-flex flex-1 items-center justify-center rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-bg transition-colors hover:bg-[var(--accent-bright)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {status === "submitting" ? "Authorizing…" : "Approve"}
          </button>
          <button
            type="button"
            disabled={status === "submitting"}
            onClick={() => void handleAction("deny")}
            className="inline-flex items-center justify-center rounded-lg border border-border bg-transparent px-5 py-2.5 text-sm font-medium text-muted transition-colors hover:border-[var(--border-strong)] hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
          >
            Deny
          </button>
        </div>

        {errorMessage !== null && (
          <p className="mt-4 text-sm text-[#ef4444]">{errorMessage}</p>
        )}

        <p className="mt-6 text-[11px] leading-relaxed text-muted">
          Revoke any time from{" "}
          <Link
            href="/dashboard/devices"
            className="text-muted underline decoration-[var(--border-strong)] underline-offset-2 hover:text-text"
          >
            your dashboard
          </Link>
          .
        </p>
      </Card>
    </Shell>
  );
}

export default function DevicePage(): JSX.Element {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center px-6">
          <p className="text-sm text-muted">Loading…</p>
        </main>
      }
    >
      <DevicePageInner />
    </Suspense>
  );
}
