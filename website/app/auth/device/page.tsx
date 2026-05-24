"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { authedFetch, useUser } from "@/lib/auth-client";

type Action = "approve" | "deny";
type Status = "idle" | "submitting" | "done" | "error";

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
          typeof body === "object" && body !== null && typeof (body as { error?: unknown }).error === "string"
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

  if (!code) {
    return (
      <main style={{ maxWidth: 480, margin: "4rem auto", padding: "0 1rem" }}>
        <h1>Authorize a device</h1>
        <p>This page must be opened with a device code. Re-run the sign-in command from the IDE.</p>
      </main>
    );
  }

  if (loading) {
    return (
      <main style={{ maxWidth: 480, margin: "4rem auto", padding: "0 1rem" }}>
        <p>Checking your session…</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main style={{ maxWidth: 480, margin: "4rem auto", padding: "0 1rem" }}>
        <h1>Sign in to authorize</h1>
        <p>
          An eri IDE wants to connect. Sign in first, then return to this page
          (your code is preserved in the URL).
        </p>
        <Link href={`/sign-in?next=${encodeURIComponent(`/auth/device?code=${code}`)}`}>
          Sign in →
        </Link>
      </main>
    );
  }

  if (status === "done" && result !== null) {
    return (
      <main style={{ maxWidth: 480, margin: "4rem auto", padding: "0 1rem" }}>
        <h1>{result === "approve" ? "Device connected" : "Request denied"}</h1>
        <p>
          {result === "approve"
            ? "You can return to the IDE — it should pick up the session within a few seconds."
            : "No token was issued. You can close this page."}
        </p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 520, margin: "4rem auto", padding: "0 1rem" }}>
      <h1>Authorize this device</h1>
      <p>
        An eri IDE is asking to sign in as <strong>{user.email}</strong>.
      </p>
      <p>
        Code: <code>{code}</code>
      </p>
      <p>
        Approve only if you just started this flow from your own IDE. The
        device will be able to make inference requests against your tier
        quota until you revoke it.
      </p>
      <div style={{ display: "flex", gap: "0.75rem", marginTop: "1.5rem" }}>
        <button
          type="button"
          disabled={status === "submitting"}
          onClick={() => void handleAction("approve")}
          style={{
            background: "#111",
            color: "#fff",
            padding: "0.6rem 1.2rem",
            border: "none",
            borderRadius: "0.4rem",
            cursor: "pointer",
          }}
        >
          Approve
        </button>
        <button
          type="button"
          disabled={status === "submitting"}
          onClick={() => void handleAction("deny")}
          style={{
            background: "#fff",
            color: "#111",
            padding: "0.6rem 1.2rem",
            border: "1px solid #ccc",
            borderRadius: "0.4rem",
            cursor: "pointer",
          }}
        >
          Deny
        </button>
      </div>
      {errorMessage !== null && (
        <p style={{ marginTop: "1rem", color: "#b00020" }}>{errorMessage}</p>
      )}
    </main>
  );
}

export default function DevicePage(): JSX.Element {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <DevicePageInner />
    </Suspense>
  );
}
