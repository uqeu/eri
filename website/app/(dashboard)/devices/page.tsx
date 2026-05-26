"use client";

import { useCallback, useEffect, useState } from "react";
import { authedFetch, useUser } from "@/lib/auth-client";

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

  if (!user) return null;

  const active = (devices ?? []).filter((d) => !d.revoked);
  const revoked = (devices ?? []).filter((d) => d.revoked);

  return (
    <div className="max-w-3xl">
      <p className="text-xs uppercase tracking-[0.25em] text-accent">Account</p>
      <h1 className="mt-3 font-display text-4xl md:text-5xl tracking-tight">
        Devices
      </h1>
      <p className="mt-3 text-[14px] text-muted">
        Every signed-in eri IDE you've authorized. Revoke any device to
        invalidate its bearer token instantly.
      </p>

      <div className="mt-10">
        {error && (
          <div className="rounded-md border border-red-500/30 bg-red-500/[0.04] px-4 py-3 text-[13px] text-red-300">
            {error}
          </div>
        )}

        {devices === null && !error && (
          <p className="text-[13px] text-muted">Loading…</p>
        )}

        {devices !== null && active.length === 0 && revoked.length === 0 && (
          <div className="rounded-md border border-white/10 px-6 py-10 text-center">
            <p className="text-[14px] text-paper">No devices yet.</p>
            <p className="mt-2 text-[12px] text-muted">
              When you sign in from an eri IDE, it'll show up here.
            </p>
          </div>
        )}

        {active.length > 0 && (
          <section>
            <h2 className="text-[12px] uppercase tracking-[0.22em] text-muted mb-3">
              Active · {active.length}
            </h2>
            <div className="space-y-2">
              {active.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center justify-between rounded-md border border-white/10 px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="text-[14px] text-paper truncate">
                      {d.label}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
                      <span className="font-mono">{shortId(d.id)}</span>
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
                    className="ml-4 shrink-0 rounded-md border border-white/15 px-3 py-1.5 text-[12px] text-paper transition hover:border-paper disabled:cursor-not-allowed disabled:opacity-50"
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
            <h2 className="text-[12px] uppercase tracking-[0.22em] text-muted mb-3">
              Revoked · {revoked.length}
            </h2>
            <div className="space-y-2">
              {revoked.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center justify-between rounded-md border border-white/[0.06] px-4 py-3 opacity-60"
                >
                  <div className="min-w-0">
                    <div className="text-[14px] text-muted truncate">
                      {d.label}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
                      <span className="font-mono">{shortId(d.id)}</span>
                      <span>·</span>
                      <span>signed in {formatRelativeOrAbs(d.created_at)}</span>
                      <span>·</span>
                      <span>
                        last used {formatRelativeOrAbs(d.last_used_at)}
                      </span>
                    </div>
                  </div>
                  <span className="ml-4 shrink-0 text-[11px] uppercase tracking-[0.18em] text-muted">
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
          className={`fixed bottom-6 right-6 px-4 py-3 rounded-md text-[13px] border ${
            toast.kind === "success"
              ? "border-accent/50 bg-accent/10 text-accent"
              : "border-red-500/50 bg-red-500/10 text-red-300"
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
