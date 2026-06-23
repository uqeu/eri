"use client";

import { useEffect, useRef, useState } from "react";
import { MiniBubble } from "./MiniBubble";
import { useHasWebGL } from "./useHasWebGL";
import { CanvasBoundary } from "./CanvasBoundary";

// "Fully synced": just eri, as one pretty transparent bubble. One mind, one
// memory — nothing else to draw. The WebGL bubble is gated so it only renders
// while on screen AND only when WebGL is available; otherwise a soft static
// bubble (CSS only) stands in so the layout never shifts and the page never
// crashes on machines without hardware acceleration.
export function SyncViz(): React.ReactElement {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const hasWebGL = useHasWebGL();

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const io = new IntersectionObserver((es) => setInView(es[0]?.isIntersecting ?? false), { threshold: 0 });
    io.observe(wrap);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={wrapRef} className="syncx2">
      <div className="syncx2__bubble" aria-hidden>
        {inView && hasWebGL ? (
          <CanvasBoundary fallback={<div className="syncx2__soul soul-fallback" />}>
            <MiniBubble className="syncx2__soul" tint="#bcd8ff" />
          </CanvasBoundary>
        ) : (
          <div className="syncx2__soul soul-fallback" />
        )}
      </div>
    </div>
  );
}
