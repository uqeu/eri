"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { authedFetch } from "@/lib/auth-client";

/** A connectable app from Composio's catalog (fetched dynamically — no
 *  hand-maintained list). The catalog is ~900 apps; the UI is search-driven and
 *  pins the user's connected apps when the search box is empty. */
interface ToolkitItem {
  slug: string;
  name: string;
  logo?: string;
  description?: string;
  category?: string;
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

/** How many search matches to render at once (the catalog is huge). */
const MAX_RESULTS = 60;

function StatusBadge({ status }: { status?: Status }): ReactNode {
  if (status === "active") {
    return <span className="text-[12px] text-accent">Connected</span>;
  }
  if (status === "pending") {
    return <span className="text-[12px] text-muted">Authorizing…</span>;
  }
  if (status === "error") {
    return <span className="text-[12px] text-red-400">Needs attention</span>;
  }
  return <span className="text-[12px] text-muted">Not connected</span>;
}

export default function ConnectionsPage(): ReactNode {
  const [catalog, setCatalog] = useState<ToolkitItem[]>([]);
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [query, setQuery] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [locked, setLocked] = useState<boolean>(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  // The catalog is global (same for every user) — fetch once. Per-user
  // connection status comes from /api/composio/status (refreshable).
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

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const res = await authedFetch("/api/composio/status", { method: "GET" });
      if (res.status === 402) {
        setLocked(true);
        return;
      }
      if (!res.ok) return;
      const body = (await res.json()) as { connections?: Connection[] };
      const map: Record<string, Status> = {};
      for (const c of body.connections ?? []) {
        map[c.toolkit] = c.status;
      }
      setStatuses(map);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
    void refresh();
  }, [loadCatalog, refresh]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(id);
  }, [toast]);

  // Empty search → show the apps you've connected (pinned). Typing → search the
  // whole catalog, capped so 900 apps never flood the page.
  const visible = useMemo<ToolkitItem[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return catalog
        .filter((a) => statuses[a.slug])
        .sort((a, b) => a.name.localeCompare(b.name));
    }
    return catalog
      .filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.slug.includes(q) ||
          (a.category?.toLowerCase().includes(q) ?? false),
      )
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, MAX_RESULTS);
  }, [catalog, statuses, query]);

  async function connect(slug: string): Promise<void> {
    setConnecting(slug);
    try {
      const res = await authedFetch("/api/composio/connect", {
        method: "POST",
        body: { toolkit: slug },
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
      if (body.redirectUrl) {
        window.open(body.redirectUrl, "_blank", "noopener,noreferrer");
        setStatuses((s) => ({ ...s, [slug]: "pending" }));
        setToast({
          kind: "success",
          message: "Log in on the new tab, then come back and hit Refresh.",
        });
      }
    } finally {
      setConnecting(null);
    }
  }

  const hasQuery = query.trim().length > 0;

  return (
    <div className="mx-auto max-w-3xl px-5 py-10 sm:py-14">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-medium text-paper">Connections</h1>
          <p className="mt-1.5 max-w-prose text-[13px] leading-relaxed text-muted">
            Connect your apps so eri can act on them for you — read your email, check
            your calendar, open a PR. You authorize each app with your own account;
            eri never sees your passwords.
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
          <p className="mt-1.5 text-[13px] text-muted">
            Upgrade to let eri connect and act on your apps.
          </p>
        </div>
      ) : (
        <div className="mt-8">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              catalog.length ? `Search ${catalog.length}+ apps…` : "Search apps…"
            }
            className="w-full rounded-lg border border-white/[0.1] bg-white/[0.02] px-4 py-2.5 text-[14px] text-paper placeholder:text-muted focus:border-white/[0.2] focus:outline-none"
          />

          <div className="mt-6 overflow-hidden rounded-lg border border-white/[0.08]">
            {visible.length === 0 ? (
              <div className="px-5 py-8 text-center text-[13px] text-muted">
                {loading
                  ? "Loading…"
                  : hasQuery
                    ? "No apps match that search."
                    : "Search above to find and connect any of your apps."}
              </div>
            ) : (
              visible.map((app, i) => {
                const status = statuses[app.slug];
                const isActive = status === "active";
                return (
                  <div
                    key={app.slug}
                    className={`flex items-center justify-between gap-4 px-5 py-4 ${
                      i > 0 ? "border-t border-white/[0.06]" : ""
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      {app.logo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={app.logo}
                          alt=""
                          width={20}
                          height={20}
                          className="h-5 w-5 shrink-0 rounded"
                        />
                      ) : null}
                      <div className="min-w-0">
                        <div className="text-[14px] font-medium text-paper">{app.name}</div>
                        {app.description ? (
                          <div className="truncate text-[12.5px] text-muted">
                            {app.description}
                          </div>
                        ) : app.category ? (
                          <div className="truncate text-[12.5px] text-muted">{app.category}</div>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-4">
                      <StatusBadge status={status} />
                      <button
                        onClick={() => void connect(app.slug)}
                        disabled={isActive || connecting === app.slug}
                        className="rounded-md border border-white/[0.1] px-3 py-1.5 text-[13px] text-paper transition-colors hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {isActive
                          ? "Connected"
                          : connecting === app.slug
                            ? "Opening…"
                            : status === "pending"
                              ? "Reconnect"
                              : "Connect"}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          {hasQuery && visible.length === MAX_RESULTS ? (
            <p className="mt-3 text-center text-[12px] text-muted">
              Showing the first {MAX_RESULTS} matches — keep typing to narrow it down.
            </p>
          ) : null}
        </div>
      )}

      {toast && (
        <div
          className={`fixed bottom-6 left-1/2 -translate-x-1/2 rounded-md px-4 py-2.5 text-[13px] shadow-lg ${
            toast.kind === "success"
              ? "bg-accent/15 text-accent"
              : "bg-red-500/15 text-red-300"
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
