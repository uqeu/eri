"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

// The terminal thought-stream from the homepage capability grid, rebuilt as a
// standalone, self-cycling panel for the dashboard. eri thinks (italic), runs a
// command ($), reports output (•), and finishes (✓), streaming line by line —
// then fades to the next scenario. Same look as the marketing grid (reuses the
// .cterm__* line styles); .estream__* is just the standalone shell.

type LineKind = "think" | "cmd" | "out" | "done";
interface Line {
  k: LineKind;
  t: string;
}
interface Scenario {
  logo: string;
  app: string;
  proc: ReadonlyArray<Line>;
}

const SCENARIOS: ReadonlyArray<Scenario> = [
  {
    logo: "gmail",
    app: "Gmail",
    proc: [
      { k: "think", t: "reading 42 unread…" },
      { k: "cmd", t: "eri gmail triage --inbox" },
      { k: "out", t: "38 archived · 4 need you" },
      { k: "out", t: "drafted 2 replies" },
      { k: "done", t: "inbox at zero" },
    ],
  },
  {
    logo: "google-calendar",
    app: "Calendar",
    proc: [
      { k: "think", t: "spotting the 2pm conflict…" },
      { k: "cmd", t: "eri cal move 'sync' --to 2:30" },
      { k: "out", t: "4 guests notified" },
      { k: "done", t: "moved · room rebooked" },
    ],
  },
  {
    logo: "slack",
    app: "Slack",
    proc: [
      { k: "think", t: "skimming 7 channels…" },
      { k: "cmd", t: "eri slack catchup" },
      { k: "out", t: "3 threads need you" },
      { k: "done", t: "summary in your DMs" },
    ],
  },
  {
    logo: "linear",
    app: "Linear",
    proc: [
      { k: "think", t: "parsing the call for bugs…" },
      { k: "cmd", t: "eri linear file --from call" },
      { k: "out", t: "4 issues created · triaged" },
      { k: "done", t: "assigned + labeled" },
    ],
  },
  {
    logo: "cursor",
    app: "Cursor",
    proc: [
      { k: "think", t: "scanning the auth module…" },
      { k: "cmd", t: "eri code --task 'refactor auth'" },
      { k: "out", t: "3 call sites · tokenStore → useSession()" },
      { k: "cmd", t: "git commit -m 'refactor: session auth'" },
      { k: "done", t: "shipped to your branch" },
    ],
  },
  {
    logo: "spotify",
    app: "Spotify",
    proc: [
      { k: "think", t: "reading your focus history…" },
      { k: "cmd", t: "eri spotify queue --mood focus" },
      { k: "out", t: "24 tracks · 1h32m" },
      { k: "done", t: "playing now" },
    ],
  },
];

const prefersReduced = (): boolean =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

export function EriThoughtStream(): React.ReactElement {
  const [idx, setIdx] = useState(0); // which scenario
  const [n, setN] = useState(0); // lines revealed in the current scenario

  useEffect(() => {
    const lines = SCENARIOS[idx].proc;
    const next = (): void => setIdx((i) => (i + 1) % SCENARIOS.length);

    if (prefersReduced()) {
      setN(lines.length);
      const hold = window.setTimeout(next, 5000);
      return () => window.clearTimeout(hold);
    }

    setN(0);
    let i = 0;
    const timers: number[] = [];
    const tick = (): void => {
      i += 1;
      setN(i);
      if (i < lines.length) {
        const wait = lines[i - 1]?.k === "think" ? 760 : 480;
        timers.push(window.setTimeout(tick, wait));
      } else {
        // Hold the finished frame, then move to the next app.
        timers.push(window.setTimeout(next, 2400));
      }
    };
    timers.push(window.setTimeout(tick, 300));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [idx]);

  const sc = SCENARIOS[idx];
  const lines = sc.proc;
  const done = n >= lines.length;

  return (
    <div className="estream">
      <div className="estream__bar">
        <span className="estream__dots" aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <span className="cterm__ico">
          <Image src={`/logos/${sc.logo}.svg`} alt="" width={14} height={14} />
        </span>
        <span className="cterm__title">eri · {sc.app}</span>
        <span className="estream__live">working</span>
      </div>
      <div className="estream__body">
        {lines.slice(0, n).map((l, i) => (
          <div key={`${idx}-${i}`} className={`cterm__line cterm__${l.k}`}>
            {l.k === "cmd" && <span className="cterm__prompt">$</span>}
            {l.k === "out" && <span className="cterm__bullet">•</span>}
            {l.k === "done" && <span className="cterm__check">✓</span>}
            <span>{l.t}</span>
          </div>
        ))}
        <span className={`cterm__caret${done ? " cterm__caret--idle" : ""}`} aria-hidden />
      </div>
    </div>
  );
}
