// Generates the little glowing interfaces that live on every device in the city.
// Each is an eri UI on dark glass with lime accents, drawn to a canvas and used
// as an unlit (toneMapped:false) map so the bright bits bloom. Four variants so
// the city doesn't look copy-pasted. Pure canvas-2D; runs client-side only.

import * as THREE from "three";

const BG = "#0a0b0e";
const LIME = "#d9ff57";
const INK = "rgba(245,245,243,0.92)";
const MUT = "rgba(245,245,243,0.4)";

function frame(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
  // glass top rim
  const g = ctx.createLinearGradient(0, 0, 0, h * 0.5);
  g.addColorStop(0, "rgba(255,255,255,0.10)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function pill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = LIME;
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fill();
}

function roundRect(
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

type Painter = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

// 0 — the eri pill + an answer
const uiPill: Painter = (ctx, w, h) => {
  pill(ctx, w * 0.1, h * 0.1, w * 0.34, h * 0.1);
  ctx.fillStyle = INK;
  for (let i = 0; i < 4; i++) {
    ctx.globalAlpha = 1 - i * 0.18;
    ctx.fillRect(w * 0.1, h * 0.34 + i * h * 0.11, w * (0.78 - i * 0.12), h * 0.05);
  }
  ctx.globalAlpha = 1;
};

// 1 — a chat: lime bubble + reply + input
const uiChat: Painter = (ctx, w, h) => {
  ctx.fillStyle = LIME;
  roundRect(ctx, w * 0.34, h * 0.12, w * 0.54, h * 0.18, 10);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.14)";
  roundRect(ctx, w * 0.12, h * 0.4, w * 0.5, h * 0.16, 10);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 2;
  roundRect(ctx, w * 0.1, h * 0.74, w * 0.8, h * 0.15, 10);
  ctx.stroke();
};

// 2 — a dashboard: header + lime bars
const uiDash: Painter = (ctx, w, h) => {
  ctx.fillStyle = MUT;
  ctx.fillRect(w * 0.1, h * 0.12, w * 0.45, h * 0.06);
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    roundRect(ctx, w * 0.1, h * 0.32 + i * h * 0.2, w * 0.8, h * 0.1, 6);
    ctx.fill();
    ctx.fillStyle = LIME;
    roundRect(ctx, w * 0.1, h * 0.32 + i * h * 0.2, w * (0.3 + i * 0.2), h * 0.1, 6);
    ctx.fill();
  }
};

// 3 — a terminal: lime prompt lines + cursor
const uiTerm: Painter = (ctx, w, h) => {
  ctx.fillStyle = LIME;
  for (let i = 0; i < 5; i++) {
    ctx.globalAlpha = 0.85 - i * 0.12;
    ctx.fillRect(w * 0.1, h * 0.16 + i * h * 0.14, w * (0.3 + (i % 3) * 0.18), h * 0.05);
  }
  ctx.globalAlpha = 1;
  ctx.fillRect(w * 0.1, h * 0.16 + 5 * h * 0.14, w * 0.08, h * 0.06);
};

const PAINTERS: Painter[] = [uiPill, uiChat, uiDash, uiTerm];

export function makeEriUITextures(): THREE.CanvasTexture[] {
  return PAINTERS.map((paint) => {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 320;
    const ctx = c.getContext("2d")!;
    frame(ctx, c.width, c.height);
    paint(ctx, c.width, c.height);
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 4;
    return tex;
  });
}
