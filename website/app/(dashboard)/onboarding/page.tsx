"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { authedFetch } from "@/lib/auth-client";

/**
 * Connect → auto-index onboarding. The user connects Gmail / Calendar, then
 * watches eri start learning their world live — the felt "eri knows your life,
 * automatically" moment. Connecting reuses the Composio connect flow; the live
 * view polls the session-authed index-status (a safe summary of the world-model
 * projection the brain backfills off /api/v1/connections/observations).
 */

type Status = "active" | "pending" | "error";

interface IndexStatus {
  connected: string[];
  counts: { entities: number; relations: number; observations: number; predictions: number };
  byKind: Record<string, number>;
  sample: { name: string; kind: string }[];
  updatedAt: number | null;
}

const APPS: ReadonlyArray<{ slug: string; name: string; blurb: string }> = [
  { slug: "gmail", name: "Gmail", blurb: "Who emails you, and what about." },
  { slug: "googlecalendar", name: "Google Calendar", blurb: "Who you meet with, and when." },
];

const POLL_STATUS_MS = 3000;
const POLL_STATUS_ATTEMPTS = 30;
const POLL_INDEX_MS = 4000;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function Stat({ n, label }: { n: number; label: string }): ReactNode {
  return (
    <div className="flex flex-col">
      <span className="font-display text-[clamp(2rem,5vw,3rem)] font-600 leading-none tracking-[-0.03em] text-text tabular-nums">
        {n}
      </span>
      <span className="mt-1 text-[12.5px] text-text-sec">{label}</span>
    </div>
  );
}

export default function OnboardingPage(): ReactNode {
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [connecting, setConnecting] = useState<string | null>(null);
  const [index, setIndex] = useState<IndexStatus | null>(null);
  const polling = useRef<Set<string>>(new Set());

  const refreshStatus = useCallback(async (): Promise<Record<string, Status>> => {
    const res = await authedFetch("/api/composio/status", { method: "GET" });
    if (!res.ok) return {};
    const body = (await res.json()) as { connections?: { toolkit: string; status: Status }[] };
    const map: Record<string, Status> = {};
    for (const c of body.connections ?? []) map[c.toolkit] = c.status;
    setStatuses(map);
    return map;
  }, []);

  const refreshIndex = useCallback(async (): Promise<void> => {
    const res = await authedFetch("/api/v1/connections/index-status", { method: "GET" });
    if (!res.ok) return;
    setIndex((await res.json()) as IndexStatus);
  }, []);

  // Drive pending→active (the status endpoint re-checks Composio), then refresh
  // the index view as soon as it lands.
  const pollUntilActive = useCallback(
    async (slug: string): Promise<void> => {
      if (polling.current.has(slug)) return;
      polling.current.add(slug);
      try {
        for (let i = 0; i < POLL_STATUS_ATTEMPTS; i++) {
          await sleep(POLL_STATUS_MS);
          const map = await refreshStatus();
          if (map[slug] === "active") {
            void refreshIndex();
            return;
          }
        }
      } finally {
        polling.current.delete(slug);
      }
    },
    [refreshStatus, refreshIndex],
  );

  const connect = useCallback(
    async (slug: string): Promise<void> => {
      setConnecting(slug);
      try {
        const res = await authedFetch("/api/composio/connect", { method: "POST", body: { toolkit: slug } });
        if (!res.ok) return;
        const body = (await res.json()) as { redirectUrl?: string };
        setStatuses((s) => ({ ...s, [slug]: "pending" }));
        if (body.redirectUrl) window.open(body.redirectUrl, "_blank", "noopener,noreferrer");
        void pollUntilActive(slug);
      } finally {
        setConnecting(null);
      }
    },
    [pollUntilActive],
  );

  useEffect(() => {
    void refreshStatus();
    void refreshIndex();
  }, [refreshStatus, refreshIndex]);

  const anyConnected = Object.values(statuses).some((s) => s === "active");

  // Keep the live view fresh as the brain backfills (only once something's connected).
  useEffect(() => {
    if (!anyConnected) return;
    const id = window.setInterval(() => void refreshIndex(), POLL_INDEX_MS);
    return () => window.clearInterval(id);
  }, [anyConnected, refreshIndex]);

  const people = index?.byKind.person ?? 0;
  const projects = index?.byKind.project ?? 0;
  const known = index?.counts.entities ?? 0;

  return (
    <div className="mx-auto max-w-3xl px-5 py-10 sm:py-14 font-geist">
      <h1 className="font-display text-[clamp(2rem,4vw,2.9rem)] font-600 leading-[1.04] tracking-[-0.03em] text-text">
        Connect your world
      </h1>
      <p className="mt-1.5 max-w-prose text-[13.5px] leading-relaxed text-text-sec">
        eri learns who&apos;s in your life and what you&apos;re working on — automatically, from the
        accounts you connect. It reads metadata to build your world model and never sees your passwords.
      </p>

      {/* Connect cards */}
      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        {APPS.map((app) => {
          const status = statuses[app.slug];
          const active = status === "active";
          return (
            <div key={app.slug} className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-bg-card p-5">
              <div className="min-w-0">
                <div className="text-[14.5px] font-medium text-text">{app.name}</div>
                <div className="mt-0.5 text-[12.5px] text-text-sec">{app.blurb}</div>
              </div>
              {active ? (
                <span className="shrink-0 text-[12.5px] text-green-700">Connected ✓</span>
              ) : (
                <button
                  onClick={() => void connect(app.slug)}
                  disabled={connecting === app.slug}
                  className="shrink-0 rounded-full border border-border bg-bg-card px-4 py-2 text-[13.5px] text-text transition-colors hover:border-[rgba(40,33,22,0.22)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {connecting === app.slug ? "Opening…" : status === "pending" ? "Authorizing…" : "Connect"}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Live indexing view */}
      {anyConnected ? (
        <div className="mt-8 rounded-2xl border border-border bg-bg-card p-6">
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-green-600" aria-hidden />
            <h2 className="font-display text-[18px] font-600 tracking-[-0.02em] text-text">eri is learning about you</h2>
          </div>

          <div className="mt-5 flex flex-wrap gap-x-10 gap-y-5">
            <Stat n={people} label="people" />
            <Stat n={projects} label="projects" />
            <Stat n={known} label="things eri knows" />
          </div>

          {index && index.sample.length > 0 ? (
            <div className="mt-6 flex flex-wrap gap-2">
              {index.sample.map((e) => (
                <span
                  key={`${e.kind}:${e.name}`}
                  className="rounded-full border border-border bg-bg-card-2 px-3 py-1 text-[12.5px] text-text-sec"
                  title={e.kind}
                >
                  {e.name}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-5 text-[13px] text-text-sec">
              eri just started reading your accounts — names and projects will fill in here as it goes.
            </p>
          )}

          <p className="mt-6 text-[12.5px] text-text-ter">
            This keeps growing as eri reads more of your world. You can leave this page — it works in the background.
          </p>
        </div>
      ) : null}
    </div>
  );
}
