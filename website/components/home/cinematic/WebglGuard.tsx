"use client";

import React from "react";

// The page-wide canonical WebGL error boundary lives in CanvasBoundary;
// re-exported here as CanvasErrorBoundary so existing cinematic callers keep
// working against a single implementation.
export { CanvasBoundary as CanvasErrorBoundary } from "../CanvasBoundary";

// Is a WebGL context actually obtainable here? (Headless capture, locked-down
// browsers, and reduced-motion users all need the 2D poster instead of a thrown
// R3F error.) Returns null while checking, then true/false.
export function useWebGLAvailable(): boolean | null {
  const [ok, setOk] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    try {
      const c = document.createElement("canvas");
      const gl =
        c.getContext("webgl2") ||
        c.getContext("webgl") ||
        c.getContext("experimental-webgl");
      setOk(Boolean(gl));
    } catch {
      setOk(false);
    }
  }, []);
  return ok;
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    setReduced(mq.matches);
    const on = (): void => setReduced(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduced;
}
