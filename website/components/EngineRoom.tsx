"use client";

// EngineRoom — a full-bleed canvas particle visualization of the eri Engine.
//
// Three lanes share a single canvas: voice (left), diffusion core (center), and
// render (right). The animation is driven by a single requestAnimationFrame
// loop with a 6-second cycle. Everything is hand-rolled Canvas 2D — no libs,
// no CSS keyframes for the physics. Hi-DPI scaling is done via the backing
// store + ctx.scale(dpr, dpr) trick. Animation pauses when the section is off-
// screen via IntersectionObserver, and renders a single resolved frame when
// prefers-reduced-motion is set.
//
// The diffusion grid resolves a snippet of real code (see CODE_SNIPPET) cell-
// by-cell with jittered timing so the grid "boots" in a wave rather than all
// at once. Hot tokens (function, return, const, etc.) glow in eri-accent;
// everything else lives in the blue.

import type { CSSProperties, ReactElement } from "react";
import { useEffect, useRef, useState } from "react";

const COLORS = {
  bg: "#0A0A0A",
  card: "#181818",
  cardEdge: "#222224",
  text: "#d6d6dd",
  muted: "#8b8b96",
  blue: "#228df2",
  blueDim: "#1a5fa8",
  accent: "#e0ff4f",
  accentDim: "#8aa42a",
} as const;

const CYCLE_MS = 7_500;

// Phase boundaries inside the cycle, expressed as 0..1 of CYCLE_MS (7.5s).
// Voice activity now runs 0–2.28s (0.304), transition flies squares 2.28–3.42s
// (0.304→0.456, ~1.14s), diffusion 3.42–5.5s (~2.08s), render 5.0–6.6s, hold
// 6.6–7.26s. Everything from diffusion onward retains its original ~6s-cycle
// absolute duration; the voice phase is what got longer.
const PHASE = {
  voiceStart: 0.0,
  voiceCaptured: 0.304,
  transitionEnd: 0.456,
  diffStart: 0.456,
  diffEnd: 0.733,
  renderStart: 0.667,
  renderHold: 0.880,
  resetStart: 0.968,
} as const;

const VOICE_GRID_COLS = 18;
const VOICE_GRID_ROWS = 18;
const VOICE_SQUARE_GAP = 2;

const CODE_SNIPPET = [
  "export function Toggle({ on, onChange }) {",
  "  const cls = on ? 'bg-accent' : 'bg-muted';",
  "  return (",
  "    <button",
  "      onClick={() => onChange(!on)}",
  "      className={`pill ${cls}`}",
  "    >",
  "      <span className=\"dot\" />",
  "      {on ? 'Live' : 'Off'}",
  "    </button>",
  "  );",
  "}",
];

const HOT_TOKENS = new Set([
  "export",
  "function",
  "return",
  "const",
  "true",
  "false",
  "onClick",
  "className",
]);

interface CellState {
  readonly char: string;
  readonly hot: boolean;
  readonly resolveAt: number;
  readonly resolveSpan: number;
  noise: number;
}

interface VoiceSquare {
  readonly row: number;
  readonly col: number;
  readonly index: number;
  // Pulses with perlin noise during capture.
  activity: number;
  // True when this square should pulse accent yellow (hotspot).
  readonly hotSeed: number;
  // Per-square noise seeds.
  readonly seedA: number;
  readonly seedB: number;
  // Target diffusion cell index for the transition flight.
  readonly targetCellIndex: number;
  // Staggered launch offset (0..1 of the transition window).
  readonly launchDelay: number;
  // Perpendicular deflection direction for curved flight (-1 or +1) and magnitude.
  readonly arcSign: number;
  readonly arcMag: number;
  // Snapshot of activity at moment of launch, used to color the flying square.
  launchActivity: number;
}

interface RenderShape {
  readonly kind: "card" | "button" | "pill" | "row";
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

interface ShapeParticle {
  readonly targetX: number;
  readonly targetY: number;
  x: number;
  y: number;
  readonly seedAngle: number;
  readonly arrivalT: number;
  size: number;
}

interface Layout {
  width: number;
  height: number;
  voiceX: number;
  voiceW: number;
  coreX: number;
  coreW: number;
  renderX: number;
  renderW: number;
  laneTop: number;
  laneBottom: number;
  laneHeight: number;
  gridCols: number;
  gridRows: number;
  cellSize: number;
  coreGridX: number;
  coreGridY: number;
  coreGridW: number;
  coreGridH: number;
  voiceGridX: number;
  voiceGridY: number;
  voiceSquareSize: number;
}

function hashFloat(seed: number): number {
  const x = Math.sin(seed * 9301.0 + 49297.0) * 233280.0;
  return x - Math.floor(x);
}

function easeOutCubic(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - c, 3);
}

function easeInOutSine(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return 0.5 - 0.5 * Math.cos(Math.PI * c);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 === edge0) {
    return x < edge0 ? 0 : 1;
  }
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// Cheap 1D value noise for the breathing waveform.
function valueNoise1D(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const a = hashFloat(i + seed * 7.13);
  const b = hashFloat(i + 1 + seed * 7.13);
  const u = f * f * (3 - 2 * f);
  return a * (1 - u) + b * u;
}

function buildCells(layout: Layout): CellState[] {
  const cells: CellState[] = [];
  const { gridCols, gridRows } = layout;
  for (let row = 0; row < gridRows; row++) {
    const line = CODE_SNIPPET[row % CODE_SNIPPET.length] ?? "";
    const tokens = line.split(/(\s+|[(){}\[\];,.<>=`'/!?:+\-*])/);

    // Walk the line char-by-char while tracking which token we're in so we can
    // flag hot characters (matching keywords highlight as accent).
    const charHotMap: boolean[] = [];
    let cursor = 0;
    for (const tok of tokens) {
      const hot = HOT_TOKENS.has(tok.trim());
      for (let k = 0; k < tok.length; k++) {
        charHotMap[cursor + k] = hot;
      }
      cursor += tok.length;
    }

    for (let col = 0; col < gridCols; col++) {
      const char = line[col] ?? " ";
      const hot = char === " " ? false : (charHotMap[col] ?? false);
      // Resolve front sweeps left-to-right with vertical jitter, giving the
      // wave-of-clarity feel.
      const colT = col / Math.max(1, gridCols - 1);
      const rowT = row / Math.max(1, gridRows - 1);
      const jitter = hashFloat(row * 131 + col * 17) * 0.18;
      const resolveAt = colT * 0.62 + rowT * 0.1 + jitter;
      const resolveSpan = 0.18 + hashFloat(row * 53 + col * 7) * 0.14;
      cells.push({
        char,
        hot,
        resolveAt: Math.max(0, Math.min(0.92, resolveAt)),
        resolveSpan,
        noise: hashFloat(row * 911 + col * 13),
      });
    }
  }
  return cells;
}

function buildVoiceSquares(layout: Layout): VoiceSquare[] {
  const out: VoiceSquare[] = [];
  const coreCellCount = layout.gridCols * layout.gridRows;
  const total = VOICE_GRID_COLS * VOICE_GRID_ROWS;
  for (let row = 0; row < VOICE_GRID_ROWS; row++) {
    for (let col = 0; col < VOICE_GRID_COLS; col++) {
      const index = row * VOICE_GRID_COLS + col;
      // Map voice square i to core cell i % coreCellCount. We also offset by a
      // small stride so adjacent voice squares don't land on adjacent core cells —
      // gives the in-flight cloud a more diffuse look while still being
      // deterministic per square.
      const stride = Math.max(1, Math.floor(coreCellCount / total));
      const targetCellIndex = (index * stride) % coreCellCount;
      // Stagger launch by sweeping left-to-right with mild diagonal bias.
      const sweepT = (col + row * 0.5) / (VOICE_GRID_COLS + VOICE_GRID_ROWS * 0.5);
      const launchDelay = Math.max(0, Math.min(0.85, sweepT * 0.75 + hashFloat(index * 7) * 0.08));
      out.push({
        row,
        col,
        index,
        activity: 0,
        hotSeed: hashFloat(index * 311),
        seedA: hashFloat(index * 17 + 3),
        seedB: hashFloat(index * 53 + 11),
        targetCellIndex,
        launchDelay,
        arcSign: hashFloat(index * 97) > 0.5 ? 1 : -1,
        arcMag: 0.1 + hashFloat(index * 211) * 0.05,
        launchActivity: 0,
      });
    }
  }
  return out;
}

function buildRenderShapes(layout: Layout): {
  shapes: RenderShape[];
  particles: ShapeParticle[];
} {
  const baseX = layout.renderX + 22;
  const baseY = layout.laneTop + 28;
  const innerW = layout.renderW - 44;
  const shapes: RenderShape[] = [
    { kind: "card", x: baseX, y: baseY, w: innerW, h: 152 },
    { kind: "row", x: baseX + 14, y: baseY + 22, w: innerW - 28, h: 10 },
    { kind: "row", x: baseX + 14, y: baseY + 42, w: (innerW - 28) * 0.6, h: 8 },
    { kind: "pill", x: baseX + 14, y: baseY + 78, w: 70, h: 26 },
    { kind: "pill", x: baseX + 94, y: baseY + 78, w: 70, h: 26 },
    { kind: "button", x: baseX + 14, y: baseY + 118, w: innerW - 28, h: 22 },
  ];

  const particles: ShapeParticle[] = [];
  // Sample points along the perimeter and interior of each shape.
  shapes.forEach((shape, shapeIdx) => {
    const count = shape.kind === "card" ? 110 : shape.kind === "button" ? 60 : 36;
    for (let i = 0; i < count; i++) {
      const r = hashFloat(shapeIdx * 1009 + i * 13);
      const r2 = hashFloat(shapeIdx * 211 + i * 41);
      // Mostly perimeter, some interior fill.
      const onEdge = r2 > 0.25;
      let tx: number;
      let ty: number;
      if (onEdge) {
        const side = Math.floor(r * 4);
        const u = hashFloat(shapeIdx * 7 + i * 23);
        if (side === 0) {
          tx = shape.x + u * shape.w;
          ty = shape.y;
        } else if (side === 1) {
          tx = shape.x + shape.w;
          ty = shape.y + u * shape.h;
        } else if (side === 2) {
          tx = shape.x + u * shape.w;
          ty = shape.y + shape.h;
        } else {
          tx = shape.x;
          ty = shape.y + u * shape.h;
        }
      } else {
        tx = shape.x + r * shape.w;
        ty = shape.y + hashFloat(shapeIdx * 313 + i * 29) * shape.h;
      }
      particles.push({
        targetX: tx,
        targetY: ty,
        x: tx,
        y: ty,
        seedAngle: hashFloat(shapeIdx * 991 + i * 7) * Math.PI * 2,
        arrivalT: 0.05 + hashFloat(shapeIdx * 47 + i * 19) * 0.55,
        size: shape.kind === "card" ? 1.2 : 1.6,
      });
    }
  });

  return { shapes, particles };
}

function computeLayout(width: number, height: number): Layout {
  const padX = 28;
  const gap = 18;
  const headerH = 56;
  const instrumentsH = 110;
  const laneTop = headerH + 18;
  const laneBottom = height - instrumentsH - 18;
  const laneHeight = laneBottom - laneTop;
  const usable = width - padX * 2 - gap * 2;
  const voiceW = Math.round(usable * 0.28);
  const coreW = Math.round(usable * 0.44);
  const renderW = usable - voiceW - coreW;
  const voiceX = padX;
  const coreX = voiceX + voiceW + gap;
  const renderX = coreX + coreW + gap;

  // Compute the core grid so every cell is square and centered.
  const gridCols = 38;
  const gridRows = 12;
  const cellSizeByW = (coreW - 36) / gridCols;
  const cellSizeByH = (laneHeight - 64) / gridRows;
  const cellSize = Math.max(6, Math.min(cellSizeByW, cellSizeByH));
  const coreGridW = cellSize * gridCols;
  const coreGridH = cellSize * gridRows;
  const coreGridX = coreX + (coreW - coreGridW) / 2;
  const coreGridY = laneTop + (laneHeight - coreGridH) / 2 + 6;

  // Voice grid: square-ish heatmap centered in the voice lane, with caption
  // space at the bottom.
  const voiceInnerW = voiceW - 40;
  const voiceInnerH = laneHeight - 80;
  const voiceSquareByW = (voiceInnerW - VOICE_SQUARE_GAP * (VOICE_GRID_COLS - 1)) / VOICE_GRID_COLS;
  const voiceSquareByH = (voiceInnerH - VOICE_SQUARE_GAP * (VOICE_GRID_ROWS - 1)) / VOICE_GRID_ROWS;
  const voiceSquareSize = Math.max(6, Math.min(voiceSquareByW, voiceSquareByH));
  const voiceTotalW =
    voiceSquareSize * VOICE_GRID_COLS + VOICE_SQUARE_GAP * (VOICE_GRID_COLS - 1);
  const voiceTotalH =
    voiceSquareSize * VOICE_GRID_ROWS + VOICE_SQUARE_GAP * (VOICE_GRID_ROWS - 1);
  const voiceGridX = voiceX + (voiceW - voiceTotalW) / 2;
  const voiceGridY = laneTop + 38 + Math.max(0, (voiceInnerH - voiceTotalH) / 2);

  return {
    width,
    height,
    voiceX,
    voiceW,
    coreX,
    coreW,
    renderX,
    renderW,
    laneTop,
    laneBottom,
    laneHeight,
    gridCols,
    gridRows,
    cellSize,
    coreGridX,
    coreGridY,
    coreGridW,
    coreGridH,
    voiceGridX,
    voiceGridY,
    voiceSquareSize,
  };
}

function drawLaneFrame(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  hint: string,
): void {
  ctx.save();
  ctx.fillStyle = COLORS.card;
  ctx.strokeStyle = COLORS.cardEdge;
  ctx.lineWidth = 1;
  roundedRect(ctx, x, y, w, h, 14);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = COLORS.muted;
  ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textBaseline = "top";
  ctx.fillText(label.toUpperCase(), x + 16, y + 14);
  ctx.fillStyle = COLORS.muted;
  ctx.textAlign = "right";
  ctx.fillText(hint, x + w - 16, y + 14);
  ctx.textAlign = "left";
  ctx.restore();
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function voiceSquarePosition(
  layout: Layout,
  square: VoiceSquare,
): { x: number; y: number } {
  const size = layout.voiceSquareSize;
  const x = layout.voiceGridX + square.col * (size + VOICE_SQUARE_GAP);
  const y = layout.voiceGridY + square.row * (size + VOICE_SQUARE_GAP);
  return { x, y };
}

function coreCellPosition(
  layout: Layout,
  cellIndex: number,
): { x: number; y: number } {
  const col = cellIndex % layout.gridCols;
  const row = Math.floor(cellIndex / layout.gridCols);
  return {
    x: layout.coreGridX + col * layout.cellSize,
    y: layout.coreGridY + row * layout.cellSize,
  };
}

function drawVoiceLane(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  squares: VoiceSquare[],
  cycleT: number,
  tMs: number,
  prefersReduced: boolean,
): void {
  drawLaneFrame(
    ctx,
    layout.voiceX,
    layout.laneTop,
    layout.voiceW,
    layout.laneHeight,
    "voice",
    "input · 48kHz",
  );

  const capturing = cycleT < PHASE.voiceCaptured;
  const inTransition = cycleT >= PHASE.voiceCaptured && cycleT < PHASE.transitionEnd;
  const transitionT = inTransition
    ? (cycleT - PHASE.voiceCaptured) / (PHASE.transitionEnd - PHASE.voiceCaptured)
    : cycleT >= PHASE.transitionEnd
      ? 1
      : 0;

  // Capture-window intensity envelope: starts low, rises, plateaus near the end.
  const captureEnvelope = capturing
    ? smoothstep(0, PHASE.voiceCaptured * 0.55, cycleT) * (0.55 + 0.45 * Math.min(1, cycleT / PHASE.voiceCaptured))
    : 1;

  const size = layout.voiceSquareSize;

  // Compute waveform centerY per column once per frame. The wave is a primary
  // sine plus a value-noise wobble, scrolling horizontally with cycleT so it
  // reads as moving audio. Constants scale with VOICE_GRID_ROWS so the wave
  // covers roughly the middle 60% of the grid regardless of resolution.
  const waveAmp = VOICE_GRID_ROWS * 0.29; // ~5.2 at 18 rows, ~3.5 at 12 rows
  const waveFreq = (Math.PI * 1.6) / VOICE_GRID_COLS; // ~1.6 crests across the grid
  const waveCenter = (VOICE_GRID_ROWS - 1) / 2;
  const waveFalloff = VOICE_GRID_ROWS * 0.18; // ~3.3 at 18 rows, ~2.2 at 12 rows
  const waveTime = cycleT * 6.0;
  const centerYs: number[] = new Array(VOICE_GRID_COLS);
  for (let col = 0; col < VOICE_GRID_COLS; col++) {
    const sine = Math.sin(col * waveFreq + waveTime);
    const wobble = (valueNoise1D(col * 0.7 + waveTime * 0.3, 1) - 0.5) * 2;
    centerYs[col] = waveCenter + sine * waveAmp + wobble * waveAmp;
  }

  // Per-square intensity is always computed (even outside capture) so that the
  // launch snapshot reflects the wave shape at the moment of capture-end.
  for (const sq of squares) {
    const centerY = centerYs[sq.col] ?? waveCenter;
    const dist = Math.abs(sq.row - centerY);
    // Linear falloff: cells within `waveFalloff` rows of the wave path are lit.
    const intensity = Math.max(0, 1 - dist / waveFalloff);
    const reducedActivity = Math.max(0, 1 - Math.abs(sq.row - waveCenter) / (waveFalloff * 1.4)) * 0.7;
    sq.activity = prefersReduced ? reducedActivity : intensity * captureEnvelope;
  }

  // Phase 1: paint the waveform across the grid.
  if (capturing) {
    for (const sq of squares) {
      const { x, y } = voiceSquarePosition(layout, sq);
      const intensity = sq.activity; // already scaled by captureEnvelope (or reduced-motion fallback)
      const rawIntensity = prefersReduced
        ? sq.activity / 0.7
        : Math.max(0, 1 - Math.abs(sq.row - (centerYs[sq.col] ?? waveCenter)) / waveFalloff);

      // Dim base tile so the off-wave grid stays barely visible.
      ctx.fillStyle = `rgba(31, 42, 58, 0.25)`;
      ctx.fillRect(x, y, size, size);

      // Accent waveform layer.
      if (intensity > 0.01) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        const alpha = intensity * 0.9;
        ctx.fillStyle = `rgba(224, 255, 79, ${alpha.toFixed(3)})`;
        ctx.fillRect(x, y, size, size);
        ctx.restore();

        // Hot core for the peak cells closest to the wave path.
        if (rawIntensity > 0.7) {
          const coreAlpha = (rawIntensity - 0.7) / 0.3 * captureEnvelope * 0.9;
          const inset = size * 0.28;
          ctx.fillStyle = `rgba(251, 255, 214, ${coreAlpha.toFixed(3)})`;
          ctx.fillRect(x + inset, y + inset, size - inset * 2, size - inset * 2);
        }
      }
    }
  }

  // Phase 2: in-flight transition. Each square eases from its grid position to
  // its target core cell with a small curved deflection. The launch snapshot
  // captures the wave-driven intensity so the squares that were the brightest
  // crests are the brightest particles in flight.
  if (inTransition) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const flightWindow = 0.55; // each square's flight occupies 55% of the window.
    for (const sq of squares) {
      // Snapshot once at the transition boundary. We read the raw intensity
      // (independent of captureEnvelope) so wave peaks remain crisp in flight.
      if (sq.launchActivity === 0) {
        const centerY = centerYs[sq.col] ?? waveCenter;
        const raw = Math.max(0, 1 - Math.abs(sq.row - centerY) / waveFalloff);
        sq.launchActivity = raw;
      }
      const launchActivity = sq.launchActivity;

      const localStart = sq.launchDelay * (1 - flightWindow);
      const localT = (transitionT - localStart) / flightWindow;
      const t = Math.max(0, Math.min(1, localT));

      const start = voiceSquarePosition(layout, sq);
      const target = coreCellPosition(layout, sq.targetCellIndex);

      // Cubic ease-out for forward progress.
      const eased = easeOutCubic(t);
      // Curved deflection: perpendicular offset peaks at t=0.5.
      const arc = Math.sin(t * Math.PI);
      const dx = target.x - start.x;
      const dy = target.y - start.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const perpX = dist > 0 ? -dy / dist : 0;
      const perpY = dist > 0 ? dx / dist : 0;
      const arcOffset = arc * dist * sq.arcMag * sq.arcSign;

      const x = start.x + dx * eased + perpX * arcOffset;
      const y = start.y + dy * eased + perpY * arcOffset;

      // Shrink from voice square size toward the diffusion cell size as it
      // arrives.
      const sz = size + (layout.cellSize - size) * eased;

      // Squares with low launchActivity (off-wave) fly dim blue; wave-peak
      // squares fly bright accent yellow. Skip the dimmest cells entirely so
      // the in-flight cloud reads as the wave breaking apart.
      if (launchActivity < 0.05) continue;
      const alpha = (0.3 + launchActivity * 0.7) * (1 - eased * 0.15);
      ctx.fillStyle = `rgba(224, 255, 79, ${alpha.toFixed(3)})`;
      ctx.fillRect(x, y, sz, sz);
    }
    ctx.restore();
  }

  // Reset launchActivity once we leave the transition so the next cycle starts
  // clean.
  if (cycleT >= PHASE.transitionEnd && cycleT < PHASE.resetStart - 0.02) {
    // No-op; we reset in the cycle boundary handler below.
  }
  if (cycleT < 0.02) {
    for (const sq of squares) sq.launchActivity = 0;
  }

  ctx.globalAlpha = 1;

  // Caption.
  ctx.fillStyle = COLORS.text;
  ctx.font = '12px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillText(
    capturing ? '"make it glow when it\'s live"' : "captured · streaming",
    layout.voiceX + 20,
    layout.laneTop + layout.laneHeight - 26,
  );
}

function drawDiffusionCore(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  cells: CellState[],
  cycleT: number,
  tMs: number,
  prefersReduced: boolean,
): void {
  const step = Math.min(8, Math.floor(8 * smoothstep(PHASE.diffStart, PHASE.diffEnd, cycleT)) + (cycleT > PHASE.diffStart ? 1 : 0));
  drawLaneFrame(
    ctx,
    layout.coreX,
    layout.laneTop,
    layout.coreW,
    layout.laneHeight,
    "diffusion core",
    `denoising step ${Math.min(8, step)}/8`,
  );

  const diffProgress = prefersReduced
    ? 1
    : smoothstep(PHASE.diffStart, PHASE.diffEnd, cycleT);

  const { coreGridX, coreGridY, cellSize, gridCols, gridRows } = layout;

  ctx.save();
  ctx.beginPath();
  ctx.rect(coreGridX - 4, coreGridY - 4, layout.coreGridW + 8, layout.coreGridH + 8);
  ctx.clip();

  // Background noise field (faint) for static-y atmosphere.
  if (!prefersReduced) {
    for (let i = 0; i < 60; i++) {
      const nx = coreGridX + Math.random() * layout.coreGridW;
      const ny = coreGridY + Math.random() * layout.coreGridH;
      ctx.fillStyle = `rgba(34, 141, 242, ${0.05 + Math.random() * 0.08})`;
      ctx.fillRect(nx, ny, 1, 1);
    }
  }

  ctx.font = `${Math.round(cellSize * 0.9)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.textBaseline = "top";

  // Scan line position (vertical bar that crosses every ~1.5s).
  const scanT = prefersReduced ? 1.1 : (tMs % 1500) / 1500;
  const scanY = coreGridY + scanT * layout.coreGridH;

  for (let row = 0; row < gridRows; row++) {
    for (let col = 0; col < gridCols; col++) {
      const cell = cells[row * gridCols + col];
      if (!cell) continue;
      const cx = coreGridX + col * cellSize;
      const cy = coreGridY + row * cellSize;

      // Per-cell resolution amount: 0=noise, 1=clear glyph.
      const localT = (diffProgress - cell.resolveAt) / cell.resolveSpan;
      const resolved = Math.max(0, Math.min(1, localT));
      const noiseAmt = 1 - resolved;

      // Refresh noise occasionally for static feel.
      if (!prefersReduced && Math.random() < 0.04) {
        cell.noise = Math.random();
      }

      // Background tile, varying brightness with noise.
      const tileAlpha = 0.04 + noiseAmt * (0.18 + cell.noise * 0.22);
      ctx.fillStyle = `rgba(34, 141, 242, ${tileAlpha})`;
      ctx.fillRect(cx + 0.5, cy + 0.5, cellSize - 1, cellSize - 1);

      // Noise dots overlay while not resolved.
      if (noiseAmt > 0.02) {
        const dotAlpha = noiseAmt * (0.3 + cell.noise * 0.5);
        ctx.fillStyle = `rgba(220, 230, 245, ${dotAlpha * 0.5})`;
        const dx = cx + (cell.noise * 0.7 + 0.15) * cellSize;
        const dy = cy + (hashFloat(row * 31 + col * 11 + Math.floor(tMs / 80)) * 0.7 + 0.15) * cellSize;
        ctx.fillRect(dx, dy, 1, 1);
      }

      // Resolved glyph.
      if (resolved > 0.05 && cell.char.trim() !== "") {
        const glyphAlpha = easeOutCubic(resolved);
        ctx.fillStyle = cell.hot
          ? `rgba(224, 255, 79, ${glyphAlpha})`
          : `rgba(180, 210, 255, ${glyphAlpha * 0.85})`;
        ctx.fillText(cell.char, cx + cellSize * 0.16, cy + cellSize * 0.06);
        if (cell.hot && glyphAlpha > 0.5) {
          ctx.save();
          ctx.shadowBlur = 6;
          ctx.shadowColor = COLORS.accent;
          ctx.fillText(cell.char, cx + cellSize * 0.16, cy + cellSize * 0.06);
          ctx.restore();
        }
      }

      // Scan-line highlight band.
      if (!prefersReduced) {
        const dist = Math.abs(cy + cellSize / 2 - scanY);
        if (dist < 18) {
          const k = 1 - dist / 18;
          ctx.fillStyle = `rgba(224, 255, 79, ${k * 0.08})`;
          ctx.fillRect(cx, cy, cellSize, cellSize);
        }
      }
    }
  }
  ctx.restore();

  // Bracket frame around the grid.
  ctx.strokeStyle = `rgba(224, 255, 79, ${0.18 + diffProgress * 0.35})`;
  ctx.lineWidth = 1;
  const bracketLen = 14;
  const bx = coreGridX - 6;
  const by = coreGridY - 6;
  const bw = layout.coreGridW + 12;
  const bh = layout.coreGridH + 12;
  ctx.beginPath();
  ctx.moveTo(bx, by + bracketLen);
  ctx.lineTo(bx, by);
  ctx.lineTo(bx + bracketLen, by);
  ctx.moveTo(bx + bw - bracketLen, by);
  ctx.lineTo(bx + bw, by);
  ctx.lineTo(bx + bw, by + bracketLen);
  ctx.moveTo(bx + bw, by + bh - bracketLen);
  ctx.lineTo(bx + bw, by + bh);
  ctx.lineTo(bx + bw - bracketLen, by + bh);
  ctx.moveTo(bx + bracketLen, by + bh);
  ctx.lineTo(bx, by + bh);
  ctx.lineTo(bx, by + bh - bracketLen);
  ctx.stroke();
}

function drawRenderLane(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  shapes: RenderShape[],
  particles: ShapeParticle[],
  cycleT: number,
  tMs: number,
  prefersReduced: boolean,
): void {
  drawLaneFrame(
    ctx,
    layout.renderX,
    layout.laneTop,
    layout.renderW,
    layout.laneHeight,
    "render",
    "preview",
  );

  const renderProgress = prefersReduced
    ? 1
    : smoothstep(PHASE.renderStart, PHASE.renderHold, cycleT);

  // Particles drift from the diffusion core area toward their target points.
  const originX = layout.coreX + layout.coreW + 8;
  const originY = layout.laneTop + layout.laneHeight / 2;

  // Once particles have arrived, fade in the shapes themselves.
  const shapeAlpha = easeOutCubic(Math.max(0, (renderProgress - 0.55) / 0.45));
  // Particles dissolve as shapes fully resolve, so the rendered preview isn't
  // littered with leftover yellow dots during the hold phase.
  const particleFade = Math.max(0, 1 - shapeAlpha);

  if (particleFade > 0.01) {
    for (const p of particles) {
      const t = Math.max(0, Math.min(1, renderProgress / Math.max(0.01, p.arrivalT)));
      const eased = easeOutCubic(t);
      const wobble = (1 - eased) * 18;
      const ox = originX + Math.cos(p.seedAngle) * 12;
      const oy = originY + Math.sin(p.seedAngle) * 12;
      p.x = ox + (p.targetX - ox) * eased + Math.cos(tMs * 0.004 + p.seedAngle) * wobble;
      p.y = oy + (p.targetY - oy) * eased + Math.sin(tMs * 0.004 + p.seedAngle) * wobble;

      const alpha = eased * 0.95 * particleFade;
      ctx.fillStyle = `rgba(224, 255, 79, ${alpha})`;
      ctx.fillRect(p.x, p.y, p.size, p.size);
    }
  }
  if (shapeAlpha > 0.02) {
    ctx.save();
    ctx.globalAlpha = shapeAlpha;
    for (const shape of shapes) {
      if (shape.kind === "card") {
        ctx.fillStyle = "rgba(24, 24, 24, 0.85)";
        ctx.strokeStyle = "rgba(224, 255, 79, 0.55)";
        ctx.lineWidth = 1;
        roundedRect(ctx, shape.x, shape.y, shape.w, shape.h, 10);
        ctx.fill();
        ctx.stroke();
      } else if (shape.kind === "row") {
        ctx.fillStyle = "rgba(214, 214, 221, 0.6)";
        roundedRect(ctx, shape.x, shape.y, shape.w, shape.h, 3);
        ctx.fill();
      } else if (shape.kind === "pill") {
        const live = shape.x < layout.renderX + 60;
        ctx.fillStyle = live ? "rgba(224, 255, 79, 0.9)" : "rgba(48, 48, 50, 0.9)";
        ctx.strokeStyle = "rgba(255,255,255,0.08)";
        roundedRect(ctx, shape.x, shape.y, shape.w, shape.h, 13);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = live ? "rgba(10,10,10,0.9)" : "rgba(214,214,221,0.85)";
        ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
        ctx.textBaseline = "middle";
        ctx.fillText(live ? "Live" : "Off", shape.x + 24, shape.y + shape.h / 2);
        ctx.beginPath();
        ctx.fillStyle = live ? "rgba(10,10,10,0.9)" : "rgba(214,214,221,0.7)";
        ctx.arc(shape.x + 13, shape.y + shape.h / 2, 4, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = "rgba(34, 141, 242, 0.85)";
        roundedRect(ctx, shape.x, shape.y, shape.w, shape.h, 6);
        ctx.fill();
        ctx.fillStyle = "rgba(10,10,10,0.95)";
        ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
        ctx.textBaseline = "middle";
        ctx.textAlign = "center";
        ctx.fillText("commit · preview", shape.x + shape.w / 2, shape.y + shape.h / 2);
        ctx.textAlign = "left";
      }
    }

    // Subtle pulse during the hold phase.
    if (cycleT > PHASE.renderHold - 0.05) {
      const pulseT = (cycleT - PHASE.renderHold + 0.05) / (PHASE.resetStart - PHASE.renderHold + 0.05);
      const k = Math.sin(pulseT * Math.PI) * 0.6;
      ctx.strokeStyle = `rgba(224, 255, 79, ${k * 0.55})`;
      ctx.lineWidth = 1;
      const card = shapes[0]!;
      roundedRect(ctx, card.x - 2, card.y - 2, card.w + 4, card.h + 4, 12);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawHeader(ctx: CanvasRenderingContext2D, layout: Layout, cycleT: number): void {
  ctx.fillStyle = COLORS.muted;
  ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textBaseline = "top";
  ctx.fillText("· ENGINE ROOM ·", 28, 22);

  ctx.fillStyle = COLORS.text;
  ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textAlign = "center";
  const status = cycleT < PHASE.diffStart
    ? "listening"
    : cycleT < PHASE.diffEnd
      ? "denoising"
      : cycleT < PHASE.renderHold
        ? "rendering"
        : "ready";
  ctx.fillText(`eri building live · ${status}`, layout.width / 2, 22);

  // Active dot.
  const dotAlpha = 0.5 + 0.5 * Math.sin(performance.now() * 0.006);
  ctx.fillStyle = `rgba(224, 255, 79, ${dotAlpha})`;
  ctx.beginPath();
  ctx.arc(layout.width / 2 - 96, 27, 3, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = COLORS.muted;
  ctx.textAlign = "right";
  ctx.fillText("INSTRUMENTS ▾", layout.width - 28, 22);
  ctx.textAlign = "left";

  // Top divider.
  ctx.strokeStyle = COLORS.cardEdge;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(20, 52);
  ctx.lineTo(layout.width - 20, 52);
  ctx.stroke();
}

interface InstrumentReadout {
  readonly steps: number;
  readonly tokens: number;
  readonly latencyMs: number;
}

function computeReadouts(cycleT: number): InstrumentReadout {
  const diffT = smoothstep(PHASE.diffStart, PHASE.diffEnd, cycleT);
  const renderT = smoothstep(PHASE.diffStart, PHASE.renderHold, cycleT);
  return {
    steps: Math.min(8, Math.floor(diffT * 8.001)),
    tokens: Math.round(renderT * 1247),
    latencyMs: Math.round(renderT * 1820),
  };
}

interface InstrumentsPanelProps {
  readonly readout: InstrumentReadout;
}

function InstrumentsPanel({ readout }: InstrumentsPanelProps): ReactElement {
  const stepActive = readout.steps >= 8;
  const items: Array<{ label: string; value: string; accent: boolean }> = [
    {
      label: "DIFFUSION STEPS",
      value: `${readout.steps}/8${stepActive ? " ✓" : ""}`,
      accent: stepActive,
    },
    {
      label: "TOKENS",
      value: readout.tokens.toLocaleString(),
      accent: false,
    },
    {
      label: "LATENCY",
      value: `${(readout.latencyMs / 1000).toFixed(2)}s`,
      accent: false,
    },
    {
      label: "MODEL",
      value: "eri Engine",
      accent: false,
    },
    {
      label: "CONTEXT",
      value: "voice + gaze + 4 files",
      accent: false,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-5" aria-hidden="true">
      {items.map((it) => (
        <div key={it.label} className="flex flex-col">
          <span className="font-mono text-[10px] tracking-[0.18em] text-[#6e6e78]">
            {it.label}
          </span>
          <span
            className="font-mono text-[15px] tabular-nums"
            style={{ color: it.accent ? COLORS.accent : COLORS.text }}
          >
            {it.value}
          </span>
        </div>
      ))}
    </div>
  );
}

export function EngineRoom(): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef<{
    layout: Layout | null;
    cells: CellState[];
    voice: VoiceSquare[];
    shapes: RenderShape[];
    shapeParticles: ShapeParticle[];
    startMs: number;
    lastFrameMs: number;
    running: boolean;
    prefersReduced: boolean;
    rafId: number | null;
  }>({
    layout: null,
    cells: [],
    voice: [],
    shapes: [],
    shapeParticles: [],
    startMs: 0,
    lastFrameMs: 0,
    running: false,
    prefersReduced: false,
    rafId: null,
  });
  const [readout, setReadout] = useState<InstrumentReadout>({
    steps: 0,
    tokens: 0,
    latencyMs: 0,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const reduceQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    stateRef.current.prefersReduced = reduceQuery.matches;

    const resize = (): void => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const rect = container.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cssW = Math.max(320, rect.width);
      const cssH = Math.max(480, rect.height);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const layout = computeLayout(cssW, cssH);
      stateRef.current.layout = layout;
      stateRef.current.cells = buildCells(layout);
      stateRef.current.voice = buildVoiceSquares(layout);
      const built = buildRenderShapes(layout);
      stateRef.current.shapes = built.shapes;
      stateRef.current.shapeParticles = built.particles;
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    const render = (nowMs: number): void => {
      const ctx = canvas.getContext("2d");
      const s = stateRef.current;
      const layout = s.layout;
      if (!ctx || !layout) {
        s.rafId = requestAnimationFrame(render);
        return;
      }
      if (s.startMs === 0) s.startMs = nowMs;
      const elapsed = nowMs - s.startMs;
      const cycleT = s.prefersReduced ? 0.93 : (elapsed % CYCLE_MS) / CYCLE_MS;
      s.lastFrameMs = nowMs;

      // Background.
      ctx.fillStyle = COLORS.bg;
      ctx.fillRect(0, 0, layout.width, layout.height);

      // Subtle grid texture.
      ctx.strokeStyle = "rgba(255,255,255,0.025)";
      ctx.lineWidth = 1;
      const grid = 48;
      ctx.beginPath();
      for (let gx = 0; gx < layout.width; gx += grid) {
        ctx.moveTo(gx + 0.5, 0);
        ctx.lineTo(gx + 0.5, layout.height);
      }
      for (let gy = 0; gy < layout.height; gy += grid) {
        ctx.moveTo(0, gy + 0.5);
        ctx.lineTo(layout.width, gy + 0.5);
      }
      ctx.stroke();

      drawHeader(ctx, layout, cycleT);
      drawVoiceLane(ctx, layout, s.voice, cycleT, nowMs, s.prefersReduced);
      drawDiffusionCore(ctx, layout, s.cells, cycleT, nowMs, s.prefersReduced);
      drawRenderLane(
        ctx,
        layout,
        s.shapes,
        s.shapeParticles,
        cycleT,
        nowMs,
        s.prefersReduced,
      );

      const readingNow = computeReadouts(cycleT);
      setReadout((prev) =>
        prev.steps === readingNow.steps &&
        prev.tokens === readingNow.tokens &&
        prev.latencyMs === readingNow.latencyMs
          ? prev
          : readingNow,
      );

      if (s.running && !s.prefersReduced) {
        s.rafId = requestAnimationFrame(render);
      } else if (s.prefersReduced) {
        // One static frame is enough.
        s.rafId = null;
      }
    };

    const start = (): void => {
      const s = stateRef.current;
      if (s.running) return;
      s.running = true;
      s.lastFrameMs = performance.now();
      s.rafId = requestAnimationFrame(render);
    };
    const stop = (): void => {
      const s = stateRef.current;
      s.running = false;
      if (s.rafId !== null) {
        cancelAnimationFrame(s.rafId);
        s.rafId = null;
      }
    };

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            start();
          } else {
            stop();
          }
        }
      },
      { threshold: 0.08 },
    );
    io.observe(container);

    const onReducedChange = (): void => {
      stateRef.current.prefersReduced = reduceQuery.matches;
      if (reduceQuery.matches) {
        // Render exactly one static frame at the resolved end-state.
        stop();
        requestAnimationFrame(render);
      } else if (!stateRef.current.running) {
        start();
      }
    };
    reduceQuery.addEventListener("change", onReducedChange);

    if (stateRef.current.prefersReduced) {
      // Single static frame.
      stateRef.current.rafId = requestAnimationFrame(render);
    }

    return () => {
      stop();
      ro.disconnect();
      io.disconnect();
      reduceQuery.removeEventListener("change", onReducedChange);
    };
  }, []);

  const sectionStyle: CSSProperties = {
    backgroundColor: COLORS.bg,
    color: COLORS.text,
  };

  return (
    <section
      className="relative w-full overflow-hidden border-y border-[#1d1d1f] py-20 md:py-28"
      style={sectionStyle}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.18]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 18% 28%, rgba(34,141,242,0.22), transparent 60%), radial-gradient(circle at 82% 72%, rgba(224,255,79,0.16), transparent 55%)",
        }}
      />

      <div className="relative mx-auto max-w-[1280px] px-6">
        <header className="mb-10 max-w-3xl">
          <span className="font-mono text-[10px] tracking-[0.32em] text-[#6e6e78]">
            · ENGINE ROOM ·
          </span>
          <h2 className="mt-4 font-display text-4xl leading-[1.05] tracking-tight text-[#e8e8ec] md:text-6xl">
            From breath to commit, in one open room.
          </h2>
          <p className="mt-5 max-w-2xl font-sans text-base leading-relaxed text-[#9a9aa3] md:text-lg">
            A live cross-section of the eri Engine. The waveform on the left is your voice;
            the lattice in the middle is the diffusion settling into code; the panel on the
            right is the preview your eyes have already started to want.
          </p>
        </header>

        <div
          ref={containerRef}
          className="relative w-full overflow-hidden rounded-2xl border border-[#1d1d1f] bg-[#0a0a0a] shadow-[0_30px_80px_rgba(0,0,0,0.45)]"
          style={{ height: 720 }}
        >
          <canvas
            ref={canvasRef}
            className="block h-full w-full"
            aria-label="Live visualization of the eri Engine: voice input, diffusion, and rendered preview."
            role="img"
          />

          <div className="absolute inset-x-0 bottom-0 border-t border-[#1d1d1f] bg-[#0d0d0d]/95 px-6 py-5 backdrop-blur">
            <div className="mb-3 flex items-center gap-3">
              <span className="h-px flex-1 bg-[#1f1f22]" />
              <span className="font-mono text-[10px] tracking-[0.32em] text-[#6e6e78]">
                INSTRUMENTS
              </span>
              <span className="h-px flex-1 bg-[#1f1f22]" />
            </div>
            <InstrumentsPanel readout={readout} />
          </div>
        </div>

        <p className="mt-6 max-w-2xl font-mono text-[11px] leading-relaxed tracking-wide text-[#6e6e78]">
          rendered at 60fps on the device you're holding · canvas 2d, hand-rolled physics,
          zero dependencies
        </p>
      </div>
    </section>
  );
}
