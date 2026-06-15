"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { authedFetch } from "@/lib/auth-client";

/** The starter set of apps eri can connect through Composio. Composio supports
 *  hundreds; this is a curated launch list. Slugs are Composio toolkit slugs. */
const APPS: ReadonlyArray<{ slug: string; name: string; blurb: string }> = [
  { slug: "gmail", name: "Gmail", blurb: "Read and send email" },
  { slug: "googlecalendar", name: "Google Calendar", blurb: "Read and create events" },
  { slug: "github", name: "GitHub", blurb: "Issues, PRs, repositories" },
  { slug: "slack", name: "Slack", blurb: "Send and read messages" },
  { slug: "notion", name: "Notion", blurb: "Read and write pages" },
  { slug: "linear", name: "Linear", blurb: "Issues and projects" },
];

type Status = "active" | "pending" | "error";

interface Connection {
  toolkit: string;
  status: Status;
}

interface Toast {
  kind: "success" | "error";
  message: string;
}

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
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [locked, setLocked] = useState<boolean>(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

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
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(id);
  }, [toast]);

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
        <div className="mt-8 overflow-hidden rounded-lg border border-white/[0.08]">
          {APPS.map((app, i) => {
            const status = statuses[app.slug];
            const isActive = status === "active";
            return (
              <div
                key={app.slug}
                className={`flex items-center justify-between gap-4 px-5 py-4 ${
                  i > 0 ? "border-t border-white/[0.06]" : ""
                }`}
              >
                <div className="min-w-0">
                  <div className="text-[14px] font-medium text-paper">{app.name}</div>
                  <div className="truncate text-[12.5px] text-muted">{app.blurb}</div>
                </div>
                <div className="flex shrink-0 items-center gap-4">
                  <StatusBadge status={status} />
                  <button
                    onClick={() => void connect(app.slug)}
                    disabled={isActive || connecting === app.slug || loading}
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
          })}
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
