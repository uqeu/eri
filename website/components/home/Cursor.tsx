"use client";

import { useEffect, useRef } from "react";

// A custom cursor for the marketing surface: a lerp-following ring rendered
// with mix-blend-difference (so it reads on both the dark hero and the light
// body), that grows and fills over interactive elements. Fine-pointer only;
// touch + reduced-motion fall back to the native cursor (component renders an
// inert node and does nothing). Mounted on the homepage only.
export function Cursor(): React.ReactElement {
  const ringRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fine = window.matchMedia?.("(pointer: fine)").matches;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const ring = ringRef.current;
    if (!fine || reduced || !ring) return;

    let x = window.innerWidth / 2;
    let y = window.innerHeight / 2;
    let rx = x;
    let ry = y;
    let visible = false;

    const onMove = (e: PointerEvent): void => {
      x = e.clientX;
      y = e.clientY;
      if (!visible) {
        visible = true;
        ring.style.opacity = "1";
      }
    };
    const interactive = "a, button, [role='button'], input, summary, label, .cursor-grow";
    const onOver = (e: PointerEvent): void => {
      const t = e.target as HTMLElement | null;
      ring.classList.toggle("on", Boolean(t?.closest(interactive)));
    };
    const onLeave = (): void => {
      visible = false;
      ring.style.opacity = "0";
    };

    document.documentElement.classList.add("has-cursor");
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerover", onOver, { passive: true });
    document.addEventListener("pointerleave", onLeave);

    let raf = 0;
    const loop = (): void => {
      rx += (x - rx) * 0.2;
      ry += (y - ry) * 0.2;
      ring.style.transform = `translate3d(${rx}px, ${ry}px, 0) translate(-50%, -50%)`;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      document.documentElement.classList.remove("has-cursor");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return <div ref={ringRef} className="eri-cursor" aria-hidden />;
}
