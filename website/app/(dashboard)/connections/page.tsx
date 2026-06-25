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

type FilterMode = "popular" | "all" | "connected";

/** Cap rendered rows so "All ~1,000" never janks the page; a search narrows it. */
const MAX_RENDER = 300;
const UNCATEGORIZED = "Other";
const ALL_CATEGORIES = "all";
/** After a Connect, poll status this many times (×3s ≈ 90s) so an app the user
 *  just authorized flips to "Connected" on its own — no manual Refresh needed. */
const POLL_ATTEMPTS = 30;
const POLL_INTERVAL_MS = 3000;

/** The well-known apps a person actually wants first, in priority order. Slugs
 *  match Composio's catalog (gmail, googlecalendar, … are its real slugs). Apps
 *  not listed here are still reachable via All / search; this only curates the
 *  default "Popular" view and the Popular sort order. */
const POPULAR_SLUGS: ReadonlyArray<string> = [
  "gmail",
  "googlecalendar",
  "googledrive",
  "googledocs",
  "googlesheets",
  "notion",
  "slack",
  "github",
  "linear",
  "spotify",
  "youtube",
  "twitter",
  "discord",
  "telegram",
  "whatsapp",
  "outlook",
  "googletasks",
  "googlemeet",
  "trello",
  "asana",
  "clickup",
  "todoist",
  "jira",
  "confluence",
  "dropbox",
  "onedrive",
  "hubspot",
  "salesforce",
  "stripe",
  "shopify",
  "airtable",
  "figma",
  "zoom",
  "calendly",
  "reddit",
  "gitlab",
  "intercom",
  "zendesk",
  "mailchimp",
  "microsoft_teams",
];
const POPULAR_RANK = new Map<string, number>(POPULAR_SLUGS.map((s, i) => [s, i]));
const popularRank = (slug: string): number =>
  POPULAR_RANK.has(slug) ? (POPULAR_RANK.get(slug) as number) : Number.POSITIVE_INFINITY;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function isConnectable(app: ToolkitItem): boolean {
  return app.connectable !== false;
}

function StatusBadge({ status }: { status?: Status }): ReactNode {
  if (status === "active") return <span className="text-[12px] text-green-700">Connected</span>;
  if (status === "pending") return <span className="text-[12px] text-text-sec">Authorizing…</span>;
  if (status === "error") return <span className="text-[12px] text-red-600">Needs attention</span>;
  return null;
}

/** What connecting this app takes — only shown when it's not the frictionless
 *  default (managed OAuth), so the directory stays calm. */
function AuthHint({ app }: { app: ToolkitItem }): ReactNode {
  if (app.authKind === "api_key") {
    return <span className="rounded border border-border px-1.5 py-0.5 text-[10.5px] text-text-ter">API key</span>;
  }
  return null;
}

export default function ConnectionsPage(): ReactNode {
  const [catalog, setCatalog] = useState<ToolkitItem[]>([]);
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [query, setQuery] = useState<string>("");
  const [filter, setFilter] = useState<FilterMode>("popular");
  const [category, setCategory] = useState<string>(ALL_CATEGORIES);
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

  // The connectable apps only — the directory never shows an app a user can't
  // actually link (custom-OAuth without a registered config), which is what made
  // the old list feel like a raw dump.
  const connectable = useMemo(() => catalog.filter(isConnectable), [catalog]);

  // Categories present in the connectable catalog, for the filter menu.
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const a of connectable) set.add(a.category || UNCATEGORIZED);
    return [...set].sort((a, b) => {
      if (a === UNCATEGORIZED) return 1;
      if (b === UNCATEGORIZED) return -1;
      return a.localeCompare(b);
    });
  }, [connectable]);

  // Filter → search → sort → cap. A flat, app-store-style list: the tabs pick the
  // pool, the category menu narrows it, the sort menu orders it.
  const { items, shownCount, totalMatched } = useMemo(() => {
    const q = query.trim().toLowerCase();
    let pool =
      filter === "connected"
        ? catalog.filter((a) => statuses[a.slug])
        : filter === "popular"
          ? connectable.filter((a) => POPULAR_RANK.has(a.slug))
          : connectable;

    if (category !== ALL_CATEGORIES) {
      pool = pool.filter((a) => (a.category || UNCATEGORIZED) === category);
    }
    if (q) {
      pool = pool.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.slug.includes(q) ||
          (a.category?.toLowerCase().includes(q) ?? false),
      );
    }

    // Popular tab is rank-ordered (curated first); All / Connected are A-Z. No
    // separate sort control — the tab implies the order.
    const byPopular = filter === "popular";
    const sorted = [...pool].sort((a, b) => {
      if (byPopular) {
        const ra = popularRank(a.slug);
        const rb = popularRank(b.slug);
        if (ra !== rb) return ra - rb;
      }
      return a.name.localeCompare(b.name);
    });

    return {
      items: sorted.slice(0, MAX_RENDER),
      shownCount: Math.min(sorted.length, MAX_RENDER),
      totalMatched: sorted.length,
    };
  }, [catalog, connectable, statuses, query, filter, category]);

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
    { id: "popular", label: "Popular" },
    { id: "all", label: `All${connectable.length ? ` ${connectable.length}` : ""}` },
    { id: "connected", label: "Connected" },
  ];

  const selectClass =
    "rounded-full border border-border bg-bg-card px-3 py-1.5 text-[12.5px] text-text-sec transition-colors hover:border-[rgba(40,33,22,0.22)] focus:border-[rgba(40,33,22,0.22)] focus:outline-none";

  return (
    <div className="mx-auto max-w-3xl px-5 py-10 sm:py-14 font-geist">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[clamp(2rem,4vw,2.9rem)] font-600 leading-[1.04] tracking-[-0.03em] text-text">Connections</h1>
          <p className="mt-1.5 max-w-prose text-[13px] leading-relaxed text-text-sec">
            Everything eri can act on for you. Connect an app with your own account.
            eri reads your email, checks your calendar, opens a PR, and never sees
            your passwords.
          </p>
        </div>
        <button
          onClick={() => void refresh()}
          className="shrink-0 rounded-full border border-border bg-bg-card px-4 py-2 text-[13.5px] text-text transition-colors hover:border-[rgba(40,33,22,0.22)]"
        >
          Refresh
        </button>
      </div>

      {locked ? (
        <div className="mt-10 rounded-2xl border border-border bg-bg-card p-6">
          <p className="text-[14px] text-text">Connections are a Pro+ feature.</p>
          <p className="mt-1.5 text-[13px] text-text-sec">Upgrade to let eri connect and act on your apps.</p>
        </div>
      ) : (
        <div className="mt-8">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={connectable.length ? `Search ${connectable.length} apps…` : "Search apps…"}
            className="w-full rounded-xl border border-border bg-bg-card px-4 py-2.5 text-[14px] text-text placeholder:text-text-ter focus:border-[rgba(40,33,22,0.22)] focus:outline-none"
          />

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            {/* One segmented control picks the set — the tab implies the order
                (Popular = curated/ranked, All = A-Z), so there's no separate
                redundant sort menu. */}
            <div className="inline-flex rounded-full bg-bg-card-2 p-1">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  aria-pressed={filter === f.id}
                  className={`rounded-full px-3.5 py-1.5 text-[12.5px] transition-colors ${
                    filter === f.id
                      ? "bg-bg-card text-text font-500 shadow-[0_1px_2px_rgba(17,17,19,0.08)]"
                      : "text-text-sec hover:text-text"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <label className="sr-only" htmlFor="cat-filter">Filter by category</label>
            <select
              id="cat-filter"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className={selectClass}
            >
              <option value={ALL_CATEGORIES}>All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div className="mt-6">
            {items.length === 0 ? (
              <div className="rounded-2xl border border-border bg-bg-card px-5 py-8 text-center text-[13px] text-text-sec">
                {loading
                  ? "Loading the catalog…"
                  : filter === "connected"
                    ? "No apps connected yet — switch to Popular to add one."
                    : "No apps match that search."}
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-border bg-bg-card">
                {items.map((app, i) => {
                  const status = statuses[app.slug];
                  const isActive = status === "active";
                  const keyOpen = keyFor === app.slug;
                  return (
                    <div key={app.slug} className={i > 0 ? "border-t border-border" : ""}>
                      <div className="flex items-center justify-between gap-4 px-5 py-3.5">
                        <div className="flex min-w-0 items-center gap-3">
                          {app.logo ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={app.logo} alt="" width={20} height={20} className="h-5 w-5 shrink-0 rounded" />
                          ) : (
                            <div className="h-5 w-5 shrink-0 rounded bg-bg-card-2" />
                          )}
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-[14px] font-medium text-text">{app.name}</span>
                              <AuthHint app={app} />
                            </div>
                            {app.description ? (
                              <div className="truncate text-[12.5px] text-text-sec">{app.description}</div>
                            ) : null}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-4">
                          <StatusBadge status={status} />
                          {isActive ? (
                            <button
                              onClick={() => void disconnect(app.slug)}
                              disabled={disconnecting === app.slug}
                              className="rounded-full border border-border bg-bg-card px-4 py-2 text-[13.5px] text-text-sec transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {disconnecting === app.slug ? "Removing…" : "Disconnect"}
                            </button>
                          ) : (
                            <button
                              onClick={() =>
                                app.authKind === "api_key"
                                  ? (setKeyFor(keyOpen ? null : app.slug), setKeyValue(""))
                                  : void submitConnect(app.slug)
                              }
                              disabled={connecting === app.slug}
                              className="rounded-full border border-border bg-bg-card px-4 py-2 text-[13.5px] text-text transition-colors hover:border-[rgba(40,33,22,0.22)] disabled:cursor-not-allowed disabled:opacity-40"
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
                          className="flex items-center gap-2 border-t border-border bg-bg-card-2 px-5 py-3"
                        >
                          <input
                            type="password"
                            autoComplete="off"
                            value={keyValue}
                            onChange={(e) => setKeyValue(e.target.value)}
                            placeholder={`Paste your ${app.name} API key`}
                            className="min-w-0 flex-1 rounded-xl border border-border bg-bg-card px-3 py-1.5 text-[13px] text-text placeholder:text-text-ter focus:border-[rgba(40,33,22,0.22)] focus:outline-none"
                          />
                          <button
                            type="submit"
                            disabled={!keyValue.trim() || connecting === app.slug}
                            className="rounded-full border border-border bg-bg-card px-4 py-2 text-[13.5px] text-text transition-colors hover:border-[rgba(40,33,22,0.22)] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {connecting === app.slug ? "Saving…" : "Save key"}
                          </button>
                        </form>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {totalMatched > shownCount ? (
            <p className="mt-4 text-center text-[12px] text-text-sec">
              Showing {shownCount} of {totalMatched} — search to find a specific app.
            </p>
          ) : null}
        </div>
      )}

      {toast && (
        <div
          className={`fixed bottom-6 left-1/2 -translate-x-1/2 rounded-xl border px-4 py-2.5 text-[13px] shadow-lg ${
            toast.kind === "success" ? "border-border bg-bg-card text-text" : "border-red-300 bg-red-50 text-red-600"
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
