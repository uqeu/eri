"use client";

import { useEffect } from "react";
import Lenis from "lenis";

// Inertia smooth-scroll for the marketing surface (Lenis). Mounted only on the
// homepage, so it never touches the dashboard / app scroll. Honours
// prefers-reduced-motion by not engaging at all. Renders nothing.
export function SmoothScroll(): null {
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const lenis = new Lenis({
      duration: 1.1,
      // ease-out-expo: quick to start, long soft landing
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      wheelMultiplier: 1,
      touchMultiplier: 1.5,
    });

    let raf = 0;
    const loop = (time: number): void => {
      lenis.raf(time);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      lenis.destroy();
    };
  }, []);

  return null;
}
