"use client";

import { useMemo, useState } from "react";
import type { PublishedProject } from "@/app/api/_publish/store";

interface TimelineProps {
  project: PublishedProject;
  apiUrl: string;
}

function formatTs(ts: string): string {
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) {
      return ts;
    }
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return ts;
  }
}

function snippet(text: string, limit = 80): string {
  const trimmed = text.trim();
  if (trimmed.length <= limit) {
    return trimmed;
  }
  return `${trimmed.slice(0, limit - 1)}…`;
}

export function Timeline({ project, apiUrl }: TimelineProps) {
  const sortedIterations = useMemo(
    () => [...project.iterations].sort((a, b) => a.n - b.n),
    [project.iterations],
  );
  const [selectedN, setSelectedN] = useState<number>(
    sortedIterations.length > 0
      ? sortedIterations[sortedIterations.length - 1]!.n
      : 0,
  );

  const selected = sortedIterations.find((iter) => iter.n === selectedN);
  const remixHref = `eri://remix?url=${encodeURIComponent(apiUrl)}`;

  return (
    <div className="mx-auto max-w-7xl px-6 py-12">
      <header className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-accent">
            Published with eri
          </p>
          <h1 className="mt-2 font-display text-4xl sm:text-5xl tracking-tight">
            {project.name ?? project.slug}
          </h1>
          <p className="mt-2 text-sm text-muted">
            {sortedIterations.length} iteration
            {sortedIterations.length === 1 ? "" : "s"} ·{" "}
            {formatTs(project.publishedAt)}
          </p>
        </div>
        <a
          href={remixHref}
          className="inline-flex items-center gap-2 rounded-md bg-accent px-5 py-3 text-sm font-medium text-ink transition hover:brightness-110"
        >
          <span aria-hidden>⌥</span>
          <span>Remix in eri</span>
        </a>
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(260px,360px)_1fr]">
        <ol className="relative flex flex-col gap-2 border-l border-white/10 pl-6">
          {sortedIterations.map((iter) => {
            const active = iter.n === selectedN;
            return (
              <li key={iter.n} className="relative">
                <span
                  className={`absolute -left-[1.7rem] top-3 inline-block h-2 w-2 rounded-full transition ${
                    active ? "bg-accent" : "bg-white/30"
                  }`}
                  aria-hidden
                />
                <button
                  type="button"
                  onClick={() => setSelectedN(iter.n)}
                  className={`group block w-full rounded-md border px-4 py-3 text-left transition ${
                    active
                      ? "border-accent/70 bg-white/[0.04]"
                      : "border-white/10 hover:border-white/30 hover:bg-white/[0.02]"
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-display text-sm text-paper">
                      iter {String(iter.n).padStart(4, "0")}
                    </span>
                    <span className="text-[10px] uppercase tracking-wider text-muted">
                      {formatTs(iter.ts)}
                    </span>
                  </div>
                  <p
                    className={`mt-1 text-sm leading-snug ${
                      active ? "text-paper" : "text-muted"
                    }`}
                  >
                    {snippet(iter.prompt)}
                  </p>
                </button>
              </li>
            );
          })}
        </ol>

        <div className="overflow-hidden rounded-lg border border-white/10 bg-paper">
          {selected ? (
            <iframe
              key={selected.n}
              title={`iteration ${selected.n}`}
              srcDoc={selected.html}
              sandbox="allow-scripts"
              className="h-[70vh] w-full bg-paper"
            />
          ) : (
            <div className="flex h-[70vh] items-center justify-center text-sm text-muted">
              No iteration selected.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
