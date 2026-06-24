"use client";

import { useCallback, useEffect, useState } from "react";
import { authedFetch, useUser } from "@/lib/auth-client";
import { SkeletonRows } from "@/components/Skeleton";

interface Device {
  id: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
  revoked: boolean;
}

type ToastKind = "success" | "error";

interface Toast {
  kind: ToastKind;
  message: string;
}

function formatRelativeOrAbs(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 86400 * 14) return `${Math.floor(diffSec / 86400)}d ago`;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function shortId(id: string): string {
  if (id.length <= 10) return id;
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

export default function DevicesPage(): JSX.Element | null {
  const { user } = useUser();
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<Record<string, boolean>>({});
  const [revokingAll, setRevokingAll] = useState<boolean>(false);
  const [clearingRevoked, setClearingRevoked] = useState<boolean>(false);
  const [toast, setToast] = useState<Toast | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await authedFetch("/api/auth/devices");
      if (!res.ok) {
        setError("Could not load devices.");
        return;
      }
      const body: unknown = await res.json();
      const list =
        typeof body === "object" &&
        body !== null &&
        Array.isArray((body as { devices?: unknown }).devices)
          ? ((body as { devices: Device[] }).devices)
          : [];
      setDevices(list);
      setError(null);
    } catch {
      setError("Network error.");
    }
  }, []);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(id);
  }, [toast]);

  async function revoke(deviceId: string): Promise<void> {
    setRevoking((r) => ({ ...r, [deviceId]: true }));
    try {
      const res = await authedFetch(`/api/auth/devices/${deviceId}/revoke`, {
        method: "POST",
      });
      if (!res.ok) {
        setToast({ kind: "error", message: "Could not revoke." });
        return;
      }
      setToast({ kind: "success", message: "Device revoked." });
      await load();
    } catch {
      setToast({ kind: "error", message: "Network error." });
    } finally {
      setRevoking((r) => {
        const next = { ...r };
        delete next[deviceId];
        return next;
      });
    }
  }

  async function revokeAll(): Promise<void> {
    if (!window.confirm("Sign out every device? Each will need to sign in again.")) {
      return;
    }
    setRevokingAll(true);
    try {
      const res = await authedFetch("/api/auth/devices/revoke-all", {
        method: "POST",
      });
      if (!res.ok) {
        setToast({ kind: "error", message: "Could not revoke all." });
        return;
      }
      setToast({ kind: "success", message: "All devices signed out." });
      await load();
    } catch {
      setToast({ kind: "error", message: "Network error." });
    } finally {
      setRevokingAll(false);
    }
  }

  async function clearRevoked(): Promise<void> {
    if (
      !window.confirm(
        "Clear the revoked device history? This only removes already-revoked entries, no active device is affected.",
      )
    ) {
      return;
    }
    setClearingRevoked(true);
    try {
      const res = await authedFetch("/api/auth/devices/clear-revoked", {
        method: "POST",
      });
      if (!res.ok) {
        setToast({ kind: "error", message: "Could not clear history." });
        return;
      }
      setToast({ kind: "success", message: "Revoked history cleared." });
      await load();
    } catch {
      setToast({ kind: "error", message: "Network error." });
    } finally {
      setClearingRevoked(false);
    }
  }

  if (!user) return null;

  const active = (devices ?? []).filter((d) => !d.revoked);
  const revoked = (devices ?? []).filter((d) => d.revoked);

  return (
    <div className="max-w-3xl font-geist">
      <p className="font-geist-mono text-[11px] uppercase tracking-[0.18em] text-text-ter">Account</p>
      <h1 className="mt-3 font-display text-[clamp(2rem,4vw,2.9rem)] font-600 leading-[1.04] tracking-[-0.03em] text-text">
        Devices
      </h1>
      <p className="mt-3 text-[14px] text-text-sec">
        Every signed-in Eri app or CLI you've authorized. Revoke any device to
        invalidate its bearer token instantly.
      </p>

      <div className="mt-10">
        {error && (
          <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-[13px] text-red-600">
            {error}
          </div>
        )}

        {devices === null && !error && <SkeletonRows rows={3} />}

        {devices !== null && active.length === 0 && revoked.length === 0 && (
          <div className="rounded-2xl border border-border bg-bg-card px-6 py-10 text-center">
            <p className="text-[14px] text-text">No devices yet.</p>
            <p className="mt-2 text-[12px] text-text-sec">
              When you sign in from Eri, it will show up here.
            </p>
          </div>
        )}

        {active.length > 0 && (
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-geist-mono text-[11px] uppercase tracking-[0.18em] text-text-ter">
                Active · {active.length}
              </h2>
              {active.length > 1 && (
                <button
                  type="button"
                  disabled={revokingAll}
                  onClick={() => void revokeAll()}
                  className="rounded-full border border-red-300 bg-bg-card px-4 py-2 text-[13.5px] text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {revokingAll ? "Signing out…" : "Sign out all"}
                </button>
              )}
            </div>
            <div className="space-y-2">
              {active.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center justify-between rounded-xl border border-border bg-bg-card px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="text-[14px] text-text truncate">
                      {d.label}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-sec">
                      <span className="font-geist-mono">{shortId(d.id)}</span>
                      <span>·</span>
                      <span>signed in {formatRelativeOrAbs(d.created_at)}</span>
                      <span>·</span>
                      <span>
                        last used {formatRelativeOrAbs(d.last_used_at)}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={revoking[d.id] === true}
                    onClick={() => void revoke(d.id)}
                    className="ml-4 shrink-0 rounded-full border border-red-300 bg-bg-card px-4 py-2 text-[13.5px] text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {revoking[d.id] === true ? "Revoking…" : "Revoke"}
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {revoked.length > 0 && (
          <section className="mt-10">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-geist-mono text-[11px] uppercase tracking-[0.18em] text-text-ter">
                Revoked · {revoked.length}
              </h2>
              <button
                type="button"
                disabled={clearingRevoked}
                onClick={() => void clearRevoked()}
                className="rounded-full border border-border bg-bg-card px-4 py-2 text-[13.5px] text-text-sec transition hover:border-[rgba(40,33,22,0.22)] hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
              >
                {clearingRevoked ? "Clearing…" : "Clear history"}
              </button>
            </div>
            <div className="space-y-2">
              {revoked.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center justify-between rounded-xl border border-border bg-bg-card-2 px-4 py-3 opacity-60"
                >
                  <div className="min-w-0">
                    <div className="text-[14px] text-text-sec truncate">
                      {d.label}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-sec">
                      <span className="font-geist-mono">{shortId(d.id)}</span>
                      <span>·</span>
                      <span>signed in {formatRelativeOrAbs(d.created_at)}</span>
                      <span>·</span>
                      <span>
                        last used {formatRelativeOrAbs(d.last_used_at)}
                      </span>
                    </div>
                  </div>
                  <span className="ml-4 shrink-0 text-[11px] uppercase tracking-[0.18em] text-text-ter">
                    Revoked
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {toast && (
        <div
          role="status"
          className={`fixed bottom-6 right-6 px-4 py-3 rounded-xl text-[13px] border ${
            toast.kind === "success"
              ? "border-border bg-bg-card text-text"
              : "border-red-300 bg-red-50 text-red-600"
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
