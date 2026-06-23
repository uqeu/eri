"use client";

import { useEffect, useState } from "react";

// Can a WebGL context actually be created in this browser right now?
//
// Returns `false` on the server and on the first client render (so the markup
// matches and we never render a <Canvas> before we've checked), then flips to
// `true` only once a real context is obtained. Visitors with hardware
// acceleration disabled, no GPU, or a locked-down browser stay at `false` and
// get the static fallback instead of a thrown "Error creating WebGL context".
export function useHasWebGL(): boolean {
  const [hasWebGL, setHasWebGL] = useState(false);

  useEffect(() => {
    try {
      const canvas = document.createElement("canvas");
      const gl =
        canvas.getContext("webgl2") ||
        canvas.getContext("webgl") ||
        canvas.getContext("experimental-webgl");
      setHasWebGL(Boolean(gl));
    } catch {
      setHasWebGL(false);
    }
  }, []);

  return hasWebGL;
}
