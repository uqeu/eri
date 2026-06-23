"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";

// The sign-in left panel's living schematic: a constellation where the stars
// are mostly eri's APPS (plus a few faint sparkles), joined by light lines. It
// drifts gently and morphs through 10 procedurally-built constellations: every
// star glides to its new spot while the old lines crossfade into the new ones.
// App nodes are placed first with strong spacing so they never crowd. One rAF
// writes transforms + two path strings; reduced-motion settles it on shape 1.

// "eri" is the wordmark node; the rest are real app logos in /public/logos.
const APP_NODES = [
  "eri", "cursor", "gmail", "google-calendar", "spotify", "slack", "notion",
  "youtube", "google-sheets", "zoom", "linear", "figma", "github", "dropbox",
  "discord", "imessage", "telegram", "whatsapp", "x", "maps", "apple", "google-docs",
];
const A = APP_NODES.length; // ~22 icon nodes (placed first -> well spread)
const DOTS = 8; // a few faint sparkles
const N = A + DOTS;
const K = 50; // a big pool of constellations, picked at random
const SIZE = 440;
const C = SIZE / 2;
const RAD = 202;
const HOLD = 5200;
const MORPH = 1900;

type Pt = readonly [number, number];
interface Shape { readonly pts: ReadonlyArray<Pt>; readonly edges: ReadonlyArray<readonly [number, number]>; }

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildShapes(): Shape[] {
  const shapes: Shape[] = [];
  for (let s = 0; s < K; s++) {
    const rnd = mulberry32(2000 + s * 131);
    const ay = 0.72 + rnd() * 0.3; // vary proportions per shape
    const ring = rnd() < 0.4 ? 0.24 + rnd() * 0.2 : 0; // sometimes hollow
    const spread = 0.86 + rnd() * 0.12;
    const pts: Pt[] = [];
    for (let i = 0; i < N; i++) {
      const tries = i === 0 ? 1 : i < A ? 16 : 8; // apps spread harder
      let best: Pt = [0, 0];
      let bestD = -1;
      for (let c = 0; c < tries; c++) {
        const r = ring + (spread - ring) * Math.sqrt(rnd());
        const th = rnd() * Math.PI * 2;
        const p: Pt = [Math.cos(th) * r, Math.sin(th) * r * ay];
        let md = Infinity;
        for (const q of pts) {
          const dx = p[0] - q[0];
          const dy = p[1] - q[1];
          md = Math.min(md, dx * dx + dy * dy);
        }
        if (md > bestD) { bestD = md; best = p; }
      }
      pts.push(best);
    }
    // MST (Prim), dropping the longest links so a few stars sit alone
    const inTree = new Array(N).fill(false);
    inTree[0] = true;
    const edges: Array<readonly [number, number]> = [];
    const seen = new Set<string>();
    const key = (a: number, b: number): string => (a < b ? `${a}-${b}` : `${b}-${a}`);
    const dist = (a: number, b: number): number => Math.hypot(pts[a][0] - pts[b][0], pts[a][1] - pts[b][1]);
    const drop = 0.5 + rnd() * 0.18;
    for (let e = 0; e < N - 1; e++) {
      let ba = -1, bb = -1, bd = Infinity;
      for (let a = 0; a < N; a++) {
        if (!inTree[a]) continue;
        for (let b = 0; b < N; b++) {
          if (inTree[b]) continue;
          const d = dist(a, b);
          if (d < bd) { bd = d; ba = a; bb = b; }
        }
      }
      if (bb < 0) break;
      inTree[bb] = true;
      if (bd <= drop) { edges.push([ba, bb]); seen.add(key(ba, bb)); }
    }
    // a few extra short links -> the "crazy" loops and triangles
    const extra = Math.floor(rnd() * 4);
    for (let x = 0; x < extra; x++) {
      const a = Math.floor(rnd() * N);
      let b = -1, bd = Infinity;
      for (let c = 0; c < N; c++) {
        if (c === a || seen.has(key(a, c))) continue;
        const d = dist(a, c);
        if (d < bd && d < 0.42) { bd = d; b = c; }
      }
      if (b >= 0) { edges.push([a, b]); seen.add(key(a, b)); }
    }
    shapes.push({ pts, edges });
  }
  return shapes;
}

const SHAPES = buildShapes();
const DOT_IDX = Array.from({ length: DOTS }, (_, i) => A + i);

const easeInOut = (t: number): number =>
  t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;

const reduced = (): boolean =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

const pathFor = (edges: Shape["edges"], pts: Array<[number, number]>): string =>
  edges.map(([a, b]) => `M${pts[a][0].toFixed(1)} ${pts[a][1].toFixed(1)}L${pts[b][0].toFixed(1)} ${pts[b][1].toFixed(1)}`).join("");

export function OrbitMark(): React.ReactElement {
  const appsRef = useRef<Array<HTMLDivElement | null>>([]);
  const dotsRef = useRef<Array<SVGCircleElement | null>>([]);
  const lineCur = useRef<SVGPathElement | null>(null);
  const lineNext = useRef<SVGPathElement | null>(null);
  const glowCur = useRef<SVGPathElement | null>(null);
  const glowNext = useRef<SVGPathElement | null>(null);

  useEffect(() => {
    const frame = (now: number, cur: number, nxt: number, t: number, drift: boolean): void => {
      const pts: Array<[number, number]> = [];
      for (let k = 0; k < N; k++) {
        const a = SHAPES[cur].pts[k];
        const b = SHAPES[nxt].pts[k];
        let x = a[0] + (b[0] - a[0]) * t;
        let y = a[1] + (b[1] - a[1]) * t;
        if (drift) {
          x += Math.sin(now * 0.0005 + k * 1.7) * 0.012;
          y += Math.cos(now * 0.0004 + k * 2.3) * 0.012;
        }
        pts.push([C + x * RAD, C + y * RAD]);
      }
      for (let i = 0; i < A; i++) {
        const el = appsRef.current[i];
        if (el) el.style.transform = `translate(${pts[i][0].toFixed(1)}px, ${pts[i][1].toFixed(1)}px) translate(-50%, -50%)`;
      }
      DOT_IDX.forEach((ni, i) => {
        const c = dotsRef.current[i];
        if (c) { c.setAttribute("cx", pts[ni][0].toFixed(1)); c.setAttribute("cy", pts[ni][1].toFixed(1)); }
      });
      const dCur = pathFor(SHAPES[cur].edges, pts);
      const dNext = pathFor(SHAPES[nxt].edges, pts);
      if (lineCur.current) { lineCur.current.setAttribute("d", dCur); lineCur.current.style.opacity = String(1 - t); }
      if (glowCur.current) { glowCur.current.setAttribute("d", dCur); glowCur.current.style.opacity = String((1 - t) * 0.7); }
      if (lineNext.current) { lineNext.current.setAttribute("d", dNext); lineNext.current.style.opacity = String(t); }
      if (glowNext.current) { glowNext.current.setAttribute("d", dNext); glowNext.current.style.opacity = String(t * 0.7); }
    };

    if (reduced()) { frame(0, 0, 0, 0, false); return; }

    const pick = (not: number): number => {
      let n = not;
      while (n === not) n = Math.floor(Math.random() * K);
      return n;
    };
    let raf = 0;
    let start = -1;
    let cur = Math.floor(Math.random() * K);
    let nxt = pick(cur);
    const total = HOLD + MORPH;
    const loop = (now: number): void => {
      if (start < 0) start = now;
      let elapsed = now - start;
      if (elapsed >= total) { cur = nxt; nxt = pick(cur); start += total; elapsed -= total; }
      const t = elapsed > HOLD ? easeInOut((elapsed - HOLD) / MORPH) : 0;
      frame(now, cur, nxt, t, true);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="constel" style={{ width: SIZE, height: SIZE }} aria-hidden>
      <svg className="constel__svg" width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        <path ref={glowCur} className="constel__glow" />
        <path ref={glowNext} className="constel__glow" />
        <path ref={lineCur} className="constel__line" />
        <path ref={lineNext} className="constel__line" />
        {DOT_IDX.map((ni, i) => (
          <circle
            key={ni}
            ref={(el) => { dotsRef.current[i] = el; }}
            className="constel__dot"
            r={1.2 + (ni % 3) * 0.5}
            style={{ animationDelay: `${(ni * 0.37).toFixed(2)}s` }}
          />
        ))}
      </svg>
      {APP_NODES.map((node, i) => (
        <div
          key={node}
          className="constel__star"
          style={{ ["--td" as string]: `${(i * 0.27).toFixed(2)}s` }}
          ref={(el) => { appsRef.current[i] = el; }}
        >
          {node === "eri" ? (
            <span className="constel__eri">eri</span>
          ) : (
            <span className="constel__chip">
              <Image src={`/logos/${node}.svg`} alt="" width={18} height={18} />
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
