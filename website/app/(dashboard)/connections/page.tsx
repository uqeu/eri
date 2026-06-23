"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { authedFetch } from "@/lib/auth-client";

/** A connectable app from Composio's catalog (fetched dynamically — no
 *  hand-maintained list). The catalog is ~1,000 apps; this is the full browsable
 *  + searchable directory of everything eri can connect to. */
type AuthKind = "managed" | "api_key" | "custom_oauth" | "none";

interface ToolkitItem {
  slug: string;
  name: string;
  logo?: string;
  description?: string;
  category?: string;
  authKind: AuthKind;
  /** Whether a user can connect this app today (custom-OAuth apps are only
   *  connectable once we've registered their auth config). Absent → treat as
   *  connectable, for back-compat. */
  connectable?: boolean;
}

type Status = "active" | "pending" | "error";

interface Connection {
  toolkit: string;
  status: Status;
}

interface Toast {
  kind: "success" | "error";
  message: string;
}

type FilterMode = "ready" | "all" | "connected";

/** Cap rendered rows so "All ~1,000" never janks the page; a search narrows it. */
const MAX_RENDER = 300;
const UNCATEGORIZED = "Other";
/** After a Connect, poll status this many times (×3s ≈ 90s) so an app the user
 *  just authorized flips to "Connected" on its own — no manual Refresh needed. */
const POLL_ATTEMPTS = 30;
const POLL_INTERVAL_MS = 3000;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function isConnectable(app: ToolkitItem): boolean {
  return app.connectable !== false;
}

function StatusBadge({ status }: { status?: Status }): ReactNode {
  if (status === "active") return <span className="text-[12px] text-accent">Connected</span>;
  if (status === "pending") return <span className="text-[12px] text-muted">Authorizing…</span>;
  if (status === "error") return <span className="text-[12px] text-red-400">Needs attention</span>;
  return null;
}

/** What connecting this app takes — only shown when it's not the frictionless
 *  default (managed OAuth), so the directory stays calm. */
function AuthHint({ app }: { app: ToolkitItem }): ReactNode {
  if (app.authKind === "api_key") {
    return <span className="rounded border border-white/[0.1] px-1.5 py-0.5 text-[10.5px] text-muted">API key</span>;
  }
  // A custom-OAuth app is only labelled "Setup required" while it has no auth
  // config; once configured it connects like any other, so drop the badge.
  if (app.authKind === "custom_oauth" && !isConnectable(app)) {
    return <span className="rounded border border-white/[0.1] px-1.5 py-0.5 text-[10.5px] text-muted">Setup required</span>;
  }
  return null;
}

export default function ConnectionsPage(): ReactNode {
  const [catalog, setCatalog] = useState<ToolkitItem[]>([]);
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [query, setQuery] = useState<string>("");
  const [filter, setFilter] = useState<FilterMode>("ready");
  const [loading, setLoading] = useState<boolean>(true);
  const [locked, setLocked] = useState<boolean>(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [keyFor, setKeyFor] = useState<string | null>(null);
  const [keyValue, setKeyValue] = useState<string>("");
  const [toast, setToast] = useState<Toast | null>(null);
  // Toolkits we're actively polling for completion (so the button shows a spinner
  // state and we don't start a second poll loop for the same app).
  const polling = useRef<Set<string>>(new Set());

  const loadCatalog = useCallback(async (): Promise<void> => {
    const res = await authedFetch("/api/composio/toolkits", { method: "GET" });
    if (res.status === 402) {
      setLocked(true);
      return;
    }
    if (!res.ok) return;
    const body = (await res.json()) as { toolkits?: ToolkitItem[] };
    setCatalog(body.toolkits ?? []);
  }, []);

  // Refresh connection statuses and return the fresh map (so a poll loop can read
  // the latest without racing React state).
  const refresh = useCallback(async (): Promise<Record<string, Status>> => {
    try {
      const res = await authedFetch("/api/composio/status", { method: "GET" });
      if (res.status === 402) {
        setLocked(true);
        return {};
      }
      if (!res.ok) return {};
      const body = (await res.json()) as { connections?: Connection[] };
      const map: Record<string, Status> = {};
      for (const c of body.connections ?? []) map[c.toolkit] = c.status;
      setStatuses(map);
      return map;
    } finally {
      setLoading(false);
    }
  }, []);

  // Poll until `slug` goes active (or we give up). The status endpoint re-checks
  // pending accounts against Composio, which is what actually drives pending→active
  // (Composio's OAuth is hosted; there's no callback to our backend).
  const pollUntilActive = useCallback(
    async (slug: string): Promise<void> => {
      if (polling.current.has(slug)) return;
      polling.current.add(slug);
      try {
        for (let i = 0; i < POLL_ATTEMPTS; i++) {
          await sleep(POLL_INTERVAL_MS);
          const map = await refresh();
          if (map[slug] === "active") {
            setToast({ kind: "success", message: "Connected." });
            return;
          }
        }
      } finally {
        polling.current.delete(slug);
      }
    },
    [refresh],
  );

  useEffect(() => {
    void loadCatalog();
    void refresh();
  }, [loadCatalog, refresh]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(id);
  }, [toast]);

  // Filter → search → cap → group by category. "ready" hides apps that aren't
  // connectable yet (custom-OAuth without a registered auth config).
  const { groups, shownCount, totalMatched } = useMemo(() => {
    const q = query.trim().toLowerCase();
    let pool = catalog;
    if (filter === "connected") pool = pool.filter((a) => statuses[a.slug]);
    else if (filter === "ready") pool = pool.filter(isConnectable);
    if (q) {
      pool = pool.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.slug.includes(q) ||
          (a.category?.toLowerCase().includes(q) ?? false),
      );
    }
    pool = [...pool].sort((a, b) => a.name.localeCompare(b.name));
    const total = pool.length;
    const shown = pool.slice(0, MAX_RENDER);
    const byCat = new Map<string, ToolkitItem[]>();
    for (const a of shown) {
      const cat = a.category || UNCATEGORIZED;
      const arr = byCat.get(cat) ?? [];
      arr.push(a);
      byCat.set(cat, arr);
    }
    const ordered = [...byCat.entries()].sort((a, b) => {
      if (a[0] === UNCATEGORIZED) return 1;
      if (b[0] === UNCATEGORIZED) return -1;
      return a[0].localeCompare(b[0]);
    });
    return { groups: ordered, shownCount: shown.length, totalMatched: total };
  }, [catalog, statuses, query, filter]);

  // Start an OAuth or API-key connection. `apiKey` is set only for the API-key
  // flow (the toolkit imports the key directly, with no consent redirect).
  async function submitConnect(slug: string, apiKey?: string): Promise<void> {
    setConnecting(slug);
    try {
      const res = await authedFetch("/api/composio/connect", {
        method: "POST",
        body: apiKey ? { toolkit: slug, apiKey } : { toolkit: slug },
      });
      if (res.status === 402) {
        setLocked(true);
        return;
      }
      if (!res.ok) {
        setToast({ kind: "error", message: "Couldn't start that connection. Try again." });
        return;
      }
      const body = (await res.json()) as { redirectUrl?: string };
      setStatuses((s) => ({ ...s, [slug]: "pending" }));
      setKeyFor(null);
      setKeyValue("");
      if (body.redirectUrl) {
        // OAuth: open Composio's hosted consent page, then poll for completion so
        // the user just authorizes and comes back to "Connected".
        window.open(body.redirectUrl, "_blank", "noopener,noreferrer");
        setToast({ kind: "success", message: "Authorize in the new tab — this updates automatically." });
      } else {
        // API-key import: no redirect, it's already submitted server-side.
        setToast({ kind: "success", message: "Key saved — verifying…" });
      }
      void pollUntilActive(slug);
    } finally {
      setConnecting(null);
    }
  }

  async function disconnect(slug: string): Promise<void> {
    setDisconnecting(slug);
    try {
      const res = await authedFetch("/api/composio/disconnect", { method: "POST", body: { toolkit: slug } });
      if (!res.ok) {
        setToast({ kind: "error", message: "Couldn't disconnect. Try again." });
        return;
      }
      setStatuses((s) => {
        const next = { ...s };
        delete next[slug];
        return next;
      });
      setToast({ kind: "success", message: "Disconnected." });
    } finally {
      setDisconnecting(null);
    }
  }

  const FILTERS: ReadonlyArray<{ id: FilterMode; label: string }> = [
    { id: "ready", label: "Ready to connect" },
    { id: "all", label: `All${catalog.length ? ` ${catalog.length}` : ""}` },
    { id: "connected", label: "Connected" },
  ];

  return (
    <div className="mx-auto max-w-3xl px-5 py-10 sm:py-14">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-medium text-paper">Connections</h1>
          <p className="mt-1.5 max-w-prose text-[13px] leading-relaxed text-muted">
            Everything eri can act on for you. Connect an app with your own account —
            eri reads your email, checks your calendar, opens a PR. eri never sees your
            passwords.
          </p>
        </div>
        <button
          onClick={() => void refresh()}
          className="shrink-0 rounded-md border border-white/[0.1] px-3 py-1.5 text-[13px] text-paper transition-colors hover:bg-white/[0.04]"
        >
          Refresh
        </button>
      </div>

      {locked ? (
        <div className="mt-10 rounded-lg border border-white/[0.08] bg-white/[0.02] p-6">
          <p className="text-[14px] text-paper">Connections are a Pro+ feature.</p>
          <p className="mt-1.5 text-[13px] text-muted">Upgrade to let eri connect and act on your apps.</p>
        </div>
      ) : (
        <div className="mt-8">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={catalog.length ? `Search ${catalog.length} apps…` : "Search apps…"}
            className="w-full rounded-lg border border-white/[0.1] bg-white/[0.02] px-4 py-2.5 text-[14px] text-paper placeholder:text-muted focus:border-white/[0.2] focus:outline-none"
          />

          <div className="mt-3 flex gap-2">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={`rounded-full px-3 py-1 text-[12.5px] transition-colors ${
                  filter === f.id
                    ? "bg-white/[0.1] text-paper"
                    : "border border-white/[0.08] text-muted hover:bg-white/[0.04]"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="mt-6 space-y-7">
            {groups.length === 0 ? (
              <div className="rounded-lg border border-white/[0.08] px-5 py-8 text-center text-[13px] text-muted">
                {loading
                  ? "Loading the catalog…"
                  : filter === "connected"
                    ? "No apps connected yet — switch to Ready to connect."
                    : "No apps match that search."}
              </div>
            ) : (
              groups.map(([category, apps]) => (
                <div key={category}>
                  <h2 className="mb-2 text-[12px] font-medium uppercase tracking-wide text-muted">{category}</h2>
                  <div className="overflow-hidden rounded-lg border border-white/[0.08]">
                    {apps.map((app, i) => {
                      const status = statuses[app.slug];
                      const isActive = status === "active";
                      const connectable = isConnectable(app);
                      const keyOpen = keyFor === app.slug;
                      return (
                        <div
                          key={app.slug}
                          className={i > 0 ? "border-t border-white/[0.06]" : ""}
                        >
                          <div className="flex items-center justify-between gap-4 px-5 py-3.5">
                            <div className="flex min-w-0 items-center gap-3">
                              {app.logo ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={app.logo} alt="" width={20} height={20} className="h-5 w-5 shrink-0 rounded" />
                              ) : (
                                <div className="h-5 w-5 shrink-0 rounded bg-white/[0.06]" />
                              )}
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="truncate text-[14px] font-medium text-paper">{app.name}</span>
                                  <AuthHint app={app} />
                                </div>
                                {app.description ? (
                                  <div className="truncate text-[12.5px] text-muted">{app.description}</div>
                                ) : null}
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-4">
                              <StatusBadge status={status} />
                              {isActive ? (
                                <button
                                  onClick={() => void disconnect(app.slug)}
                                  disabled={disconnecting === app.slug}
                                  className="rounded-md border border-white/[0.1] px-3 py-1.5 text-[13px] text-muted transition-colors hover:bg-white/[0.04] hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  {disconnecting === app.slug ? "Removing…" : "Disconnect"}
                                </button>
                              ) : !connectable ? (
                                <span className="rounded-md border border-white/[0.06] px-3 py-1.5 text-[12.5px] text-muted">
                                  Needs setup
                                </span>
                              ) : (
                                <button
                                  onClick={() =>
                                    app.authKind === "api_key"
                                      ? (setKeyFor(keyOpen ? null : app.slug), setKeyValue(""))
                                      : void submitConnect(app.slug)
                                  }
                                  disabled={connecting === app.slug}
                                  className="rounded-md border border-white/[0.1] px-3 py-1.5 text-[13px] text-paper transition-colors hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  {connecting === app.slug
                                    ? "Opening…"
                                    : status === "pending"
                                      ? "Reconnect"
                                      : "Connect"}
                                </button>
                              )}
                            </div>
                          </div>
                          {keyOpen && !isActive ? (
                            <form
                              onSubmit={(e) => {
                                e.preventDefault();
                                if (keyValue.trim()) void submitConnect(app.slug, keyValue.trim());
                              }}
                              className="flex items-center gap-2 border-t border-white/[0.06] bg-white/[0.01] px-5 py-3"
                            >
                              <input
                                type="password"
                                autoComplete="off"
                                value={keyValue}
                                onChange={(e) => setKeyValue(e.target.value)}
                                placeholder={`Paste your ${app.name} API key`}
                                className="min-w-0 flex-1 rounded-md border border-white/[0.1] bg-white/[0.02] px-3 py-1.5 text-[13px] text-paper placeholder:text-muted focus:border-white/[0.2] focus:outline-none"
                              />
                              <button
                                type="submit"
                                disabled={!keyValue.trim() || connecting === app.slug}
                                className="rounded-md border border-white/[0.1] px-3 py-1.5 text-[13px] text-paper transition-colors hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                {connecting === app.slug ? "Saving…" : "Save key"}
                              </button>
                            </form>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>

          {totalMatched > shownCount ? (
            <p className="mt-4 text-center text-[12px] text-muted">
              Showing {shownCount} of {totalMatched} — search to find a specific app.
            </p>
          ) : null}
        </div>
      )}

      {toast && (
        <div
          className={`fixed bottom-6 left-1/2 -translate-x-1/2 rounded-md px-4 py-2.5 text-[13px] shadow-lg ${
            toast.kind === "success" ? "bg-accent/15 text-accent" : "bg-red-500/15 text-red-300"
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
