"use client";

import { useEffect, useRef } from "react";

// eri's soul — a clear glass orb holding a living ocean. Light, luminous water
// (teal / aqua / blue with eri-lime bioluminescence) drifts like currents inside
// a glass sphere; motes and bubbles float through it; a glassy specular highlight
// and bright rim sell the glass; everything is soft and a little blurry, then
// melts into the page. It follows the cursor and breathes. Pure canvas-2D, so it
// renders in headless capture and degrades to a still under reduced-motion.

interface Current { rgb: string; ox: number; oy: number; amp: number; sx: number; sy: number; ph: number; rad: number; add: boolean }

// Ocean currents — translucent water colours layered (source-over) for depth,
// plus a couple of additive bioluminescent ones (add:true).
const CURRENTS: readonly Current[] = [
  { rgb: "30,140,180", ox: -0.18, oy: -0.2, amp: 0.22, sx: 0.33, sy: 0.46, ph: 0.0, rad: 0.95, add: false }, // teal
  { rgb: "46,108,210", ox: 0.22, oy: -0.06, amp: 0.24, sx: 0.4, sy: 0.3, ph: 1.7, rad: 0.92, add: false }, // blue
  { rgb: "20,90,150", ox: 0.06, oy: 0.26, amp: 0.2, sx: 0.27, sy: 0.42, ph: 3.1, rad: 0.85, add: false }, // deep
  { rgb: "120,235,235", ox: -0.24, oy: 0.16, amp: 0.26, sx: 0.46, sy: 0.36, ph: 4.4, rad: 0.8, add: true }, // aqua glow
  { rgb: "190,255,120", ox: 0.14, oy: 0.1, amp: 0.3, sx: 0.5, sy: 0.55, ph: 5.6, rad: 0.6, add: true }, // lime biolum
];

interface Mote { x: number; y: number; size: number; sp: number; hue: 0 | 1 | 2; tw: number; bubble: boolean }
function makeMotes(n: number): Mote[] {
  return Array.from({ length: n }, (_, i) => {
    const r = Math.sqrt(Math.random()) * 0.88;
    const a = Math.random() * Math.PI * 2;
    return {
      x: Math.cos(a) * r,
      y: Math.sin(a) * r,
      size: 0.5 + Math.random() * (i % 9 === 0 ? 3.2 : 1.3),
      sp: 0.02 + Math.random() * 0.06,
      hue: (i % 7 === 0 ? 2 : i % 3 === 0 ? 1 : 0) as 0 | 1 | 2,
      tw: Math.random() * Math.PI * 2,
      bubble: i % 9 === 0,
    };
  });
}
const MOTE_RGB: Record<0 | 1 | 2, string> = { 0: "200,255,110", 1: "235,255,255", 2: "150,225,255" };

function reduced(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export function SoulOrb({ className }: { readonly className?: string }): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const isReduced = reduced();
    const motes = makeMotes(210);

    let W = 0;
    let H = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = (): void => {
      const rect = canvas.getBoundingClientRect();
      W = rect.width;
      H = rect.height;
      canvas.width = Math.floor(W * dpr);
      canvas.height = Math.floor(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const canBlur = (() => {
      try {
        ctx.filter = "blur(2px)";
        const ok = ctx.filter === "blur(2px)";
        ctx.filter = "none";
        return ok;
      } catch {
        return false;
      }
    })();

    const target = { x: 0, y: 0 };
    const cur = { x: 0, y: 0 };
    const onMove = (e: PointerEvent): void => {
      const r = canvas.getBoundingClientRect();
      target.x = clamp((e.clientX - (r.left + r.width / 2)) / r.width, -0.6, 0.6);
      target.y = clamp((e.clientY - (r.top + r.height / 2)) / r.height, -0.6, 0.6);
    };

    const draw = (time: number): void => {
      const cx = W / 2;
      const cy = H / 2;
      const R = Math.min(W, H) * 0.32;
      const breathe = 1 + 0.03 * Math.sin(time * 1.4);
      cur.x += (target.x - cur.x) * 0.06;
      cur.y += (target.y - cur.y) * 0.06;
      const Rb = R * breathe;

      ctx.clearRect(0, 0, W, H);

      // 1) soft outer glow — aqua/cyan/lime, blends the orb into the page
      ctx.globalCompositeOperation = "lighter";
      for (const [rgb, off] of [["90,210,225", 0], ["120,255,160", 0.4]] as const) {
        const g = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, R * (1.85 + off));
        g.addColorStop(0, `rgba(${rgb},0.1)`);
        g.addColorStop(1, `rgba(${rgb},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, Rb, 0, Math.PI * 2);
      ctx.clip();

      // 2) clear water base — light, lit from above (never dark)
      ctx.globalCompositeOperation = "source-over";
      const base = ctx.createRadialGradient(cx, cy - Rb * 0.35, Rb * 0.2, cx, cy + Rb * 0.2, Rb * 1.25);
      base.addColorStop(0, "rgba(232,251,255,0.95)");
      base.addColorStop(0.55, "rgba(150,224,235,0.8)");
      base.addColorStop(1, "rgba(70,150,195,0.85)");
      ctx.fillStyle = base;
      ctx.fillRect(cx - Rb, cy - Rb, Rb * 2, Rb * 2);

      // 3) flowing ocean currents (soft + blurry)
      if (canBlur) ctx.filter = "blur(7px)";
      for (const c of CURRENTS) {
        ctx.globalCompositeOperation = c.add ? "lighter" : "source-over";
        const bx = cx + (c.ox + Math.sin(time * c.sx + c.ph) * c.amp + cur.x * 0.22) * Rb;
        const by = cy + (c.oy + Math.cos(time * c.sy + c.ph) * c.amp + cur.y * 0.22) * Rb;
        const rr = Rb * c.rad;
        const g = ctx.createRadialGradient(bx, by, 0, bx, by, rr);
        g.addColorStop(0, `rgba(${c.rgb},${c.add ? 0.5 : 0.42})`);
        g.addColorStop(0.55, `rgba(${c.rgb},${c.add ? 0.14 : 0.18})`);
        g.addColorStop(1, `rgba(${c.rgb},0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(bx, by, rr, 0, Math.PI * 2);
        ctx.fill();
      }
      if (canBlur) ctx.filter = "none";

      // 4) caustic sheen — soft light bands drifting through the water
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < 2; i++) {
        const yy = cy + Math.sin(time * 0.4 + i * 2) * Rb * 0.3 - Rb * 0.1;
        const cg = ctx.createRadialGradient(cx, yy, 0, cx, yy, Rb * 0.9);
        cg.addColorStop(0, "rgba(220,255,255,0.12)");
        cg.addColorStop(1, "rgba(220,255,255,0)");
        ctx.fillStyle = cg;
        ctx.fillRect(cx - Rb, cy - Rb, Rb * 2, Rb * 2);
      }

      // 5) motes + bubbles rising through the water
      for (const m of motes) {
        const yy = ((m.y - time * m.sp + 1.9) % 1.76) - 0.88; // drift up, wrap
        const mx = cx + m.x * Rb;
        const my = cy + yy * Rb;
        const tw = 0.55 + 0.45 * Math.sin(time * 2 + m.tw);
        if (m.bubble) {
          ctx.globalCompositeOperation = "lighter";
          ctx.strokeStyle = `rgba(${MOTE_RGB[m.hue]},${0.35 * tw})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(mx, my, m.size, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = `rgba(255,255,255,${0.12 * tw})`;
          ctx.fill();
        } else {
          ctx.globalCompositeOperation = "lighter";
          ctx.fillStyle = `rgba(${MOTE_RGB[m.hue]},${0.9 * tw})`;
          ctx.beginPath();
          ctx.arc(mx, my, m.size, 0, Math.PI * 2);
          ctx.fill();
          // a soft halo on the brighter motes — fireflies in deep water
          if (m.size > 1.4) {
            ctx.fillStyle = `rgba(${MOTE_RGB[m.hue]},${0.18 * tw})`;
            ctx.beginPath();
            ctx.arc(mx, my, m.size * 2.6, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      // 6) inner glass edge — a soft cool refraction ring (gives roundness,
      //    never black)
      ctx.globalCompositeOperation = "source-over";
      const edge = ctx.createRadialGradient(cx, cy, Rb * 0.72, cx, cy, Rb);
      edge.addColorStop(0, "rgba(40,90,130,0)");
      edge.addColorStop(0.85, "rgba(30,80,120,0.0)");
      edge.addColorStop(1, "rgba(20,60,100,0.32)");
      ctx.fillStyle = edge;
      ctx.fillRect(cx - Rb, cy - Rb, Rb * 2, Rb * 2);

      ctx.restore();

      // 7) glass surface — specular highlight + a small hotspot, shifting with
      //    the cursor like real light on glass
      ctx.globalCompositeOperation = "lighter";
      const hx = cx - Rb * 0.34 - cur.x * Rb * 0.28;
      const hy = cy - Rb * 0.42 - cur.y * Rb * 0.28;
      const hl = ctx.createRadialGradient(hx, hy, 0, hx, hy, Rb * 0.62);
      hl.addColorStop(0, "rgba(255,255,255,0.6)");
      hl.addColorStop(0.5, "rgba(255,255,255,0.08)");
      hl.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = hl;
      ctx.beginPath();
      ctx.arc(hx, hy, Rb * 0.62, 0, Math.PI * 2);
      ctx.fill();
      // tiny crisp hotspot
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.beginPath();
      ctx.arc(hx + Rb * 0.04, hy + Rb * 0.04, Rb * 0.04, 0, Math.PI * 2);
      ctx.fill();

      // 8) bright glass rim (Fresnel) — brightest top-left
      const rim = ctx.createLinearGradient(cx - Rb, cy - Rb, cx + Rb, cy + Rb);
      rim.addColorStop(0, "rgba(255,255,255,0.7)");
      rim.addColorStop(0.35, "rgba(180,240,255,0.12)");
      rim.addColorStop(1, "rgba(120,210,255,0.32)");
      ctx.strokeStyle = rim;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, Rb - 0.75, 0, Math.PI * 2);
      ctx.stroke();

      ctx.globalCompositeOperation = "source-over";
    };

    let raf = 0;
    const start = performance.now();
    const loop = (): void => {
      draw((performance.now() - start) / 1000);
      raf = requestAnimationFrame(loop);
    };
    const io = new IntersectionObserver(
      (es) => {
        const vis = es[0]?.isIntersecting;
        if (vis && !isReduced && !raf) raf = requestAnimationFrame(loop);
        else if (!vis && raf) { cancelAnimationFrame(raf); raf = 0; }
      },
      { threshold: 0 },
    );
    io.observe(canvas);
    const ro = new ResizeObserver(() => { resize(); if (isReduced) draw(4); });
    ro.observe(canvas);
    if (!isReduced) window.addEventListener("pointermove", onMove, { passive: true });
    if (isReduced) draw(4);
    else raf = requestAnimationFrame(loop);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      window.removeEventListener("pointermove", onMove);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={className}
      style={{
        WebkitMaskImage: "radial-gradient(circle at 50% 50%, #000 58%, transparent 76%)",
        maskImage: "radial-gradient(circle at 50% 50%, #000 58%, transparent 76%)",
      }}
    />
  );
}
