"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

// A flat graph-paper checkerboard that fills the empty side of the manifesto.
// Two layers: a lines/glow layer that twinkles faint random rainbow hues and
// fades to white at every edge (so the grid dissolves, never hard-stops), and
// a separate tiles layer of real app logos that stays crisp (never masked).
// Hover a logo and a tiny dark terminal opens where eri thinks + runs its
// process, streaming line by line. transform/opacity + cheap tint.

const COLS = 12;
const ROWS = 6;
const SHIMMER = 9;

type LineKind = "think" | "cmd" | "out" | "done";
interface Line {
  readonly k: LineKind;
  readonly t: string;
}
interface Cap {
  readonly col: number;
  readonly row: number;
  readonly logo: string;
  readonly app: string;
  readonly proc: ReadonlyArray<Line>;
}

const CAPS: ReadonlyArray<Cap> = [
  { col: 7, row: 0, logo: "cursor", app: "Cursor", proc: [
    { k: "think", t: "scanning the auth module…" },
    { k: "cmd", t: "eri code --task 'refactor auth'" },
    { k: "out", t: "found 3 call sites" },
    { k: "out", t: "tokenStore → useSession()" },
    { k: "cmd", t: "git commit -m 'refactor: session auth'" },
    { k: "done", t: "shipped to your branch" },
  ] },
  { col: 10, row: 1, logo: "gmail", app: "Gmail", proc: [
    { k: "think", t: "reading 42 unread…" },
    { k: "cmd", t: "eri gmail triage --inbox" },
    { k: "out", t: "38 archived · 4 need you" },
    { k: "out", t: "drafted 2 replies" },
    { k: "done", t: "inbox at zero" },
  ] },
  { col: 4, row: 1, logo: "google-calendar", app: "Calendar", proc: [
    { k: "think", t: "spotting the 2pm conflict…" },
    { k: "cmd", t: "eri cal move 'sync' --to 2:30" },
    { k: "out", t: "4 guests notified" },
    { k: "done", t: "moved · room rebooked" },
  ] },
  { col: 9, row: 2, logo: "spotify", app: "Spotify", proc: [
    { k: "think", t: "reading your focus history…" },
    { k: "cmd", t: "eri spotify queue --mood focus" },
    { k: "out", t: "24 tracks · 1h32m" },
    { k: "done", t: "playing now" },
  ] },
  { col: 2, row: 3, logo: "youtube", app: "YouTube", proc: [
    { k: "think", t: "watching along, timestamping…" },
    { k: "cmd", t: "eri watch --summarize" },
    { k: "out", t: "6 key moments tagged" },
    { k: "done", t: "notes saved" },
  ] },
  { col: 11, row: 3, logo: "google-sheets", app: "Sheets", proc: [
    { k: "think", t: "tracing the #REF! errors…" },
    { k: "cmd", t: "eri sheets fix --tab Q3" },
    { k: "out", t: "11 broken refs repaired" },
    { k: "done", t: "model balances" },
  ] },
  { col: 6, row: 3, logo: "slack", app: "Slack", proc: [
    { k: "think", t: "skimming 7 channels…" },
    { k: "cmd", t: "eri slack catchup" },
    { k: "out", t: "3 threads need you" },
    { k: "done", t: "summary in your DMs" },
  ] },
  { col: 8, row: 4, logo: "notion", app: "Notion", proc: [
    { k: "think", t: "structuring the call notes…" },
    { k: "cmd", t: "eri notion write --from call" },
    { k: "out", t: "1 doc · 5 action items" },
    { k: "done", t: "shared with the team" },
  ] },
  { col: 4, row: 4, logo: "zoom", app: "Zoom", proc: [
    { k: "think", t: "joining, listening in…" },
    { k: "cmd", t: "eri zoom join --notes" },
    { k: "out", t: "transcript + decisions" },
    { k: "done", t: "recap sent" },
  ] },
  { col: 10, row: 4, logo: "linear", app: "Linear", proc: [
    { k: "think", t: "parsing the call for bugs…" },
    { k: "cmd", t: "eri linear file --from call" },
    { k: "out", t: "4 issues created · triaged" },
    { k: "done", t: "assigned + labeled" },
  ] },
];

// Radial falloff toward the board centre — even glow with a high floor; the
// hard edges are dissolved by the mask on the lines layer, not by this.
const CX = (COLS - 1) / 2;
const CY = (ROWS - 1) / 2;
const MAX_D = Math.hypot(CX, CY);
const intensityAt = (col: number, row: number): number => {
  const d = Math.hypot(col - CX, row - CY) / MAX_D;
  return Math.max(0.5, 1 - d * 0.55);
};

const hash = (a: number, b: number, seed: number): number => {
  const x = Math.sin(a * 127.1 + b * 311.7 + seed * 74.7) * 43758.5453;
  return x - Math.floor(x);
};

const prefersReduced = (): boolean =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

function TerminalStream({ lines }: { lines: ReadonlyArray<Line> }): React.ReactElement {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (prefersReduced()) { setN(lines.length); return; }
    let i = 0;
    const timers: number[] = [];
    const tick = (): void => {
      i += 1;
      setN(i);
      if (i < lines.length) {
        const wait = lines[i - 1]?.k === "think" ? 720 : 470;
        timers.push(window.setTimeout(tick, wait));
      }
    };
    timers.push(window.setTimeout(tick, 260));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [lines]);

  const done = n >= lines.length;
  return (
    <div className="cterm__body">
      {lines.slice(0, n).map((l, i) => (
        <div key={i} className={`cterm__line cterm__${l.k}`}>
          {l.k === "cmd" && <span className="cterm__prompt">$</span>}
          {l.k === "out" && <span className="cterm__bullet">•</span>}
          {l.k === "done" && <span className="cterm__check">✓</span>}
          <span>{l.t}</span>
        </div>
      ))}
      <span className={`cterm__caret${done ? " cterm__caret--idle" : ""}`} aria-hidden />
    </div>
  );
}

export function CapabilityGrid(): React.ReactElement {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <div className="cgrid">
      <div className="cgrid__board">
        {/* lines + rainbow twinkle, faded to white at every edge */}
        <div className="cgrid__lines" aria-hidden>
          {Array.from({ length: COLS * ROWS }, (_, i) => {
            const col = i % COLS;
            const row = Math.floor(i / COLS);
            const hue = Math.floor(hash(col, row, 1) * 360);
            const dur = (7 + hash(col, row, 2) * 6).toFixed(2);
            const delay = (hash(col, row, 3) * Number(dur)).toFixed(2);
            const cellStyle = {
              "--i": intensityAt(col, row).toFixed(3),
              "--hue": String(hue),
              "--dur": `${dur}s`,
              "--delay": `${delay}s`,
            } as React.CSSProperties;
            return <span key={i} className="cgrid__cell" style={cellStyle} />;
          })}
        </div>

        {/* app logos + terminals — crisp, never masked */}
        <div className="cgrid__tiles" role="list" aria-label="things eri does across your apps">
          {CAPS.map((cap, capIdx) => {
            const isOpen = open === capIdx;
            const hRight = cap.col >= COLS / 2;
            const vBottom = cap.row >= ROWS / 2;
            const termStyle: React.CSSProperties = {
              [hRight ? "right" : "left"]: 0,
              [vBottom ? "bottom" : "top"]: 0,
              transformOrigin: `${vBottom ? "bottom" : "top"} ${hRight ? "right" : "left"}`,
            };
            const src = `/logos/${cap.logo}.svg`;
            return (
              <button
                key={capIdx}
                type="button"
                role="listitem"
                className={`cgrid__cap${isOpen ? " is-open" : ""}`}
                style={{ gridColumn: cap.col + 1, gridRow: cap.row + 1 }}
                aria-expanded={isOpen}
                aria-label={`${cap.app} — see eri's process`}
                onMouseEnter={() => setOpen(capIdx)}
                onMouseLeave={() => setOpen((o) => (o === capIdx ? null : o))}
                onFocus={() => setOpen(capIdx)}
                onBlur={() => setOpen((o) => (o === capIdx ? null : o))}
                onClick={() => setOpen(capIdx)}
              >
                <span className="cgrid__chip" aria-hidden>
                  <Image src={src} alt="" width={18} height={18} className="cgrid__chip-img" />
                </span>
                {isOpen && (
                  <div className="cterm" style={termStyle} role="dialog" aria-label={`eri running ${cap.app}`}>
                    <div className="cterm__bar">
                      <span className="cterm__ico">
                        <Image src={src} alt="" width={14} height={14} />
                      </span>
                      <span className="cterm__title">eri · {cap.app}</span>
                    </div>
                    <TerminalStream key={capIdx} lines={cap.proc} />
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
