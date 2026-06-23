// The painter for the cinematic stage — pure canvas-2D, no dependencies, no
// WebGL (so it renders identically in headless capture and degrades to a still).
// Everything is drawn in CSS pixels: the caller scales the context by dpr once,
// so coordinates here match the DOM layer's percentage anchors exactly.

import type { ScreenId } from "./beats";

// ── palette: a muted dusk pulled from the brand sunset (violet → plum → gold),
// with eri's lime reserved for the soul + the screens it touches. ────────────
const SKY_TOP = "#140d28";
const SKY_MID = "#3a1c4c";
const SKY_PLUM = "#7d2f54";
const SKY_HORIZON = "#d2754a";
const SUN = "#ffd6a0";
const LIME = "#d9ff57";
const LIME_SOFT = "rgba(217,255,87,";
const VIOLET_SOFT = "rgba(150,108,255,";
const WARM_WINDOW = "rgba(255,201,143,";

export interface Building {
  readonly x: number;
  readonly w: number;
  readonly h: number; // height from the ground line
  readonly windows: ReadonlyArray<{ x: number; y: number; lime: boolean }>;
}

export interface CityLayer {
  readonly depth: number; // 0 = far/hazy, 1 = near/dark
  readonly buildings: readonly Building[];
}

export interface Frame {
  readonly w: number;
  readonly h: number;
  readonly t: number; // elapsed seconds (for drift / twinkle)
  readonly soul: { x: number; y: number }; // CSS px
  readonly trail: ReadonlyArray<{ x: number; y: number }>;
  readonly screensLit: Record<ScreenId, number>; // 0..1 glow
  readonly screenPos: Record<ScreenId, { x: number; y: number }>; // CSS px
  readonly parallax: { x: number; y: number }; // -1..1 pointer offset
  readonly intensity: number; // global bloom (boot ramp / resolve swell)
  readonly filament: number; // 0..1 — the one-brain thread between screens
  readonly soulVisible: number; // 0..1 fade of the soul itself
  readonly reduced: boolean;
}

// ── small deterministic PRNG so the skyline is stable across frames/resizes ──
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeLayer(w: number, h: number, depth: number, seed: number): CityLayer {
  const rng = mulberry32(seed);
  const ground = h * 0.86;
  const minW = 38 + depth * 26;
  const maxW = 92 + depth * 70;
  const maxH = (0.16 + depth * 0.26) * h;
  const buildings: Building[] = [];
  let x = -40;
  while (x < w + 40) {
    const bw = minW + rng() * (maxW - minW);
    const bh = (0.4 + rng() * 0.6) * maxH;
    const windows: { x: number; y: number; lime: boolean }[] = [];
    if (depth > 0.45) {
      const cols = Math.max(1, Math.floor(bw / 16));
      const rows = Math.max(1, Math.floor(bh / 20));
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          if (rng() > 0.78) {
            windows.push({
              x: x + 6 + c * 16,
              y: ground - bh + 10 + r * 20,
              lime: rng() > 0.9,
            });
          }
        }
      }
    }
    buildings.push({ x, w: bw, h: bh, windows });
    x += bw + (4 + rng() * 10);
  }
  return { depth, buildings };
}

export function makeCity(w: number, h: number): CityLayer[] {
  return [
    makeLayer(w, h, 0.25, 7),
    makeLayer(w, h, 0.6, 23),
    makeLayer(w, h, 1, 91),
  ];
}

// ── easing / math helpers ────────────────────────────────────────────────────
export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

// Quadratic bezier for the leap path.
export function bezier(
  p0: { x: number; y: number },
  cp: { x: number; y: number },
  p1: { x: number; y: number },
  t: number,
): { x: number; y: number } {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * cp.x + t * t * p1.x,
    y: u * u * p0.y + 2 * u * t * cp.y + t * t * p1.y,
  };
}

// ── painters ─────────────────────────────────────────────────────────────────
function paintSky(ctx: CanvasRenderingContext2D, f: Frame): void {
  const { w, h } = f;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, SKY_TOP);
  g.addColorStop(0.42, SKY_MID);
  g.addColorStop(0.68, SKY_PLUM);
  g.addColorStop(0.9, SKY_HORIZON);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // low sun glow on the horizon, biased by parallax
  const sx = w * (0.5 + f.parallax.x * 0.06);
  const sy = h * 0.88;
  const sun = ctx.createRadialGradient(sx, sy, 0, sx, sy, h * 0.62);
  sun.addColorStop(0, "rgba(255,214,160,0.5)");
  sun.addColorStop(0.4, "rgba(255,150,110,0.16)");
  sun.addColorStop(1, "rgba(255,150,110,0)");
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, w, h);
}

function paintStars(ctx: CanvasRenderingContext2D, f: Frame): void {
  const { w, h, t } = f;
  ctx.save();
  for (let i = 0; i < 60; i++) {
    const x = ((i * 137.5) % w) + Math.sin(i) * 4;
    const y = ((i * 71.3) % (h * 0.5)) + 6;
    const tw = 0.35 + 0.35 * Math.sin(t * 1.5 + i);
    ctx.globalAlpha = tw * 0.6;
    ctx.fillStyle = i % 9 === 0 ? LIME : "#fff";
    ctx.fillRect(x, y, 1.4, 1.4);
  }
  ctx.restore();
}

function paintSkyline(
  ctx: CanvasRenderingContext2D,
  f: Frame,
  city: readonly CityLayer[],
): void {
  const { w, h } = f;
  const ground = h * 0.86;
  for (const layer of city) {
    const shift = f.parallax.x * (6 + layer.depth * 18);
    const fill = `rgba(${Math.round(lerp(46, 10, layer.depth))},${Math.round(
      lerp(30, 9, layer.depth),
    )},${Math.round(lerp(60, 20, layer.depth))},${lerp(0.55, 1, layer.depth)})`;
    ctx.fillStyle = fill;
    ctx.save();
    ctx.translate(shift, 0);
    for (const b of layer.buildings) {
      ctx.fillRect(b.x, ground - b.h, b.w, b.h + 4);
    }
    ctx.restore();
    // dusk rim light along the tops of the nearest layer
    if (layer.depth >= 1) {
      ctx.save();
      ctx.translate(shift, 0);
      ctx.fillStyle = "rgba(255,150,110,0.10)";
      for (const b of layer.buildings) ctx.fillRect(b.x, ground - b.h, b.w, 1.5);
      // windows
      for (const b of layer.buildings) {
        for (const win of b.windows) {
          ctx.fillStyle = win.lime ? LIME_SOFT + "0.5)" : WARM_WINDOW + "0.45)";
          ctx.fillRect(win.x, win.y, 2.4, 3);
        }
      }
      ctx.restore();
    }
  }
}

// Glowing screen glyphs the soul visits. Schematic, not skeuomorphic.
function paintScreen(
  ctx: CanvasRenderingContext2D,
  id: ScreenId,
  cx: number,
  cy: number,
  lit: number,
  t: number,
): void {
  const dims: Record<ScreenId, { w: number; h: number; r: number }> = {
    billboard: { w: 150, h: 92, r: 8 },
    laptop: { w: 116, h: 74, r: 7 },
    phone: { w: 46, h: 92, r: 12 },
  };
  const d = dims[id];
  const x = cx - d.w / 2;
  const y = cy - d.h / 2;
  const pulse = 0.85 + 0.15 * Math.sin(t * 2.2);
  const glow = lit * pulse;

  // ambient halo
  if (glow > 0.01) {
    const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, d.w * 1.1);
    halo.addColorStop(0, LIME_SOFT + 0.22 * glow + ")");
    halo.addColorStop(1, LIME_SOFT + "0)");
    ctx.fillStyle = halo;
    ctx.fillRect(cx - d.w * 1.2, cy - d.w * 1.2, d.w * 2.4, d.w * 2.4);
  }

  roundRectPath(ctx, x, y, d.w, d.h, d.r);
  ctx.fillStyle = `rgba(8,10,14,${lerp(0.5, 0.78, lit)})`;
  ctx.fill();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = `rgba(217,255,87,${lerp(0.12, 0.6, lit)})`;
  ctx.stroke();

  // a couple of schematic content lines on the screen
  ctx.fillStyle = `rgba(217,255,87,${0.35 * lit})`;
  ctx.fillRect(x + 10, y + 12, d.w * 0.5, 3);
  ctx.fillStyle = `rgba(255,255,255,${0.18 * lit})`;
  ctx.fillRect(x + 10, y + 22, d.w * 0.7, 2.4);
  ctx.fillRect(x + 10, y + 30, d.w * 0.42, 2.4);

  // laptop base + phone notch hint
  if (id === "laptop") {
    ctx.fillStyle = `rgba(20,22,28,${lerp(0.5, 0.85, lit)})`;
    ctx.fillRect(x - 10, y + d.h, d.w + 20, 5);
  }
  if (id === "phone") {
    ctx.fillStyle = `rgba(217,255,87,${0.5 * lit})`;
    ctx.fillRect(cx - 8, y + 7, 16, 2.5);
  }
}

function paintFilament(
  ctx: CanvasRenderingContext2D,
  f: Frame,
  order: ScreenId[],
): void {
  if (f.filament <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = f.filament;
  ctx.strokeStyle = LIME_SOFT + "0.5)";
  ctx.lineWidth = 1.4;
  ctx.shadowColor = LIME;
  ctx.shadowBlur = 12;
  ctx.beginPath();
  order.forEach((id, i) => {
    const p = f.screenPos[id];
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.stroke();
  ctx.restore();
}

function paintSoul(ctx: CanvasRenderingContext2D, f: Frame): void {
  if (f.soulVisible <= 0.01) return;
  const { soul, trail, t, intensity, soulVisible } = f;

  // comet trail
  ctx.save();
  for (let i = 0; i < trail.length; i++) {
    const a = (i / trail.length) * 0.5 * soulVisible;
    const r = lerp(1, 5, i / trail.length);
    ctx.fillStyle = LIME_SOFT + a + ")";
    ctx.beginPath();
    ctx.arc(trail[i].x, trail[i].y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  const breathe = 1 + 0.08 * Math.sin(t * 3.2);
  const R = 26 * intensity * breathe;

  // outer violet bloom
  const bloom = ctx.createRadialGradient(soul.x, soul.y, 0, soul.x, soul.y, R * 2.6);
  bloom.addColorStop(0, VIOLET_SOFT + 0.5 * soulVisible + ")");
  bloom.addColorStop(0.5, LIME_SOFT + 0.16 * soulVisible + ")");
  bloom.addColorStop(1, LIME_SOFT + "0)");
  ctx.fillStyle = bloom;
  ctx.beginPath();
  ctx.arc(soul.x, soul.y, R * 2.6, 0, Math.PI * 2);
  ctx.fill();

  // bright lime core
  const core = ctx.createRadialGradient(soul.x, soul.y, 0, soul.x, soul.y, R);
  core.addColorStop(0, `rgba(247,255,214,${soulVisible})`);
  core.addColorStop(0.5, LIME_SOFT + 0.9 * soulVisible + ")");
  core.addColorStop(1, LIME_SOFT + "0)");
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(soul.x, soul.y, R, 0, Math.PI * 2);
  ctx.fill();

  // orbiting sparks — the sense of a living thing
  ctx.fillStyle = `rgba(247,255,214,${0.9 * soulVisible})`;
  for (let i = 0; i < 3; i++) {
    const ang = t * 2 + (i * Math.PI * 2) / 3;
    const rr = R * 1.5;
    ctx.beginPath();
    ctx.arc(soul.x + Math.cos(ang) * rr, soul.y + Math.sin(ang) * rr, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const SCREEN_ORDER: ScreenId[] = ["billboard", "laptop", "phone"];

export function paint(
  ctx: CanvasRenderingContext2D,
  f: Frame,
  city: readonly CityLayer[],
): void {
  ctx.clearRect(0, 0, f.w, f.h);
  paintSky(ctx, f);
  paintStars(ctx, f);
  paintSkyline(ctx, f, city);
  for (const id of SCREEN_ORDER) {
    const p = f.screenPos[id];
    paintScreen(ctx, id, p.x, p.y, f.screensLit[id], f.t);
  }
  paintFilament(ctx, f, SCREEN_ORDER);
  paintSoul(ctx, f);
  // gentle vignette to seat the type
  const vg = ctx.createRadialGradient(
    f.w / 2,
    f.h * 0.5,
    f.h * 0.3,
    f.w / 2,
    f.h * 0.5,
    f.h * 0.95,
  );
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(8,5,16,0.55)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, f.w, f.h);
}
