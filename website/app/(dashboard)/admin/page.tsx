"use client";

import { useEffect, useState } from "react";
import { authedFetch, useUser } from "@/lib/auth-client";

interface Totals {
  requests: number;
  tokens_in: number;
  tokens_out: number;
  credits: number;
  cost_usd_micros: number;
  active_users: number;
}

interface ModelRollup {
  model: string;
  requests: number;
  tokens_in: number;
  tokens_out: number;
  cost_usd_micros: number;
}

interface UserRollup {
  user_id: string;
  email: string | null;
  tier: string | null;
  requests: number;
  credits: number;
  cost_usd_micros: number;
  last_active: string | null;
}

interface AuditEvent {
  id: string;
  user_id: string | null;
  action: string;
  ts: string;
}

interface Analytics {
  days: number;
  totals: Totals;
  by_model: ModelRollup[];
  top_users: UserRollup[];
  audit: AuditEvent[];
}

function usd(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(2)}`;
}

function num(n: number): string {
  return n.toLocaleString();
}

function shortTs(iso: string): string {
  return iso.replace("T", " ").slice(0, 16);
}

export default function AdminPage() {
  const { user } = useUser();
  const [data, setData] = useState<Analytics | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "forbidden" | "error">(
    "loading",
  );

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const res = await authedFetch("/api/v1/admin/analytics?days=30");
        if (res.status === 403) {
          if (!cancelled) setState("forbidden");
          return;
        }
        if (!res.ok) {
          if (!cancelled) setState("error");
          return;
        }
        const body = (await res.json()) as Analytics;
        if (!cancelled) {
          setData(body);
          setState("ok");
        }
      } catch {
        if (!cancelled) setState("error");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!user) return null;
  if (state === "loading") return <p className="text-sm opacity-70">Loading…</p>;
  if (state === "forbidden") {
    return (
      <div className="max-w-xl">
        <h1 className="text-xl font-semibold">Admin</h1>
        <p className="mt-2 text-sm opacity-70">
          This view is restricted to administrators.
        </p>
      </div>
    );
  }
  if (state === "error" || !data) {
    return <p className="text-sm text-red-400">Failed to load analytics.</p>;
  }

  const { totals, by_model, top_users, audit } = data;

  return (
    <div className="max-w-5xl space-y-8">
      <header>
        <h1 className="text-xl font-semibold">Admin analytics</h1>
        <p className="text-sm opacity-60">Last {data.days} days · usage only, no prompt content.</p>
      </header>

      <section className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Stat label="Active users" value={num(totals.active_users)} />
        <Stat label="Requests" value={num(totals.requests)} />
        <Stat label="Tokens in" value={num(totals.tokens_in)} />
        <Stat label="Tokens out" value={num(totals.tokens_out)} />
        <Stat label="eri credits" value={num(totals.credits)} />
        <Stat label="Cost (COGS)" value={usd(totals.cost_usd_micros)} />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase opacity-60">Top users</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left opacity-60">
              <tr>
                <th className="py-1 pr-4">User</th>
                <th className="py-1 pr-4">Tier</th>
                <th className="py-1 pr-4">Reqs</th>
                <th className="py-1 pr-4">Credits</th>
                <th className="py-1 pr-4">Cost</th>
                <th className="py-1">Last active</th>
              </tr>
            </thead>
            <tbody>
              {top_users.map((u) => (
                <tr key={u.user_id} className="border-t border-white/5">
                  <td className="py-1 pr-4">{u.email ?? u.user_id}</td>
                  <td className="py-1 pr-4">{u.tier ?? "-"}</td>
                  <td className="py-1 pr-4">{num(u.requests)}</td>
                  <td className="py-1 pr-4">{num(u.credits)}</td>
                  <td className="py-1 pr-4">{usd(u.cost_usd_micros)}</td>
                  <td className="py-1 opacity-60">
                    {u.last_active ? shortTs(u.last_active) : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase opacity-60">By model</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left opacity-60">
              <tr>
                <th className="py-1 pr-4">Model</th>
                <th className="py-1 pr-4">Reqs</th>
                <th className="py-1 pr-4">Tokens in</th>
                <th className="py-1 pr-4">Tokens out</th>
                <th className="py-1">Cost</th>
              </tr>
            </thead>
            <tbody>
              {by_model.map((m) => (
                <tr key={m.model} className="border-t border-white/5">
                  <td className="py-1 pr-4">{m.model}</td>
                  <td className="py-1 pr-4">{num(m.requests)}</td>
                  <td className="py-1 pr-4">{num(m.tokens_in)}</td>
                  <td className="py-1 pr-4">{num(m.tokens_out)}</td>
                  <td className="py-1">{usd(m.cost_usd_micros)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase opacity-60">Recent events</h2>
        {audit.length === 0 ? (
          <p className="text-sm opacity-60">No audit events yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {audit.slice(0, 40).map((e) => (
              <li key={e.id} className="flex gap-3 border-t border-white/5 py-1">
                <span className="opacity-50">{shortTs(e.ts)}</span>
                <span className="font-mono">{e.action}</span>
                <span className="opacity-60">{e.user_id ?? "-"}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 p-4">
      <div className="text-xs uppercase opacity-50">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}
