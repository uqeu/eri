"use client";

import { useEffect, useRef, useState } from "react";
import { AskExpand } from "./AskExpand";
import { BubbleField } from "./BubbleField";
import { useHasWebGL } from "./useHasWebGL";
import { CanvasBoundary } from "./CanvasBoundary";

// eri's mind, as light. A pinned stage (waabi-style scroll-pin) where real
// iridescent bubbles drift upward as you scroll, while the headline and the
// live eri demo stay put in the middle. No lines, no labels — just glass and
// light around the thing you actually talk to.
//
// A single scroll handler writes 0..1 progress into a ref the WebGL field reads
// each frame, so the drift never triggers a React re-render. WebGL-less or
// reduced-motion visitors get a calm static field.

export function ThoughtField(): React.ReactElement {
  const sectionRef = useRef<HTMLElement>(null);
  const progressRef = useRef(0);
  const [reduced, setReduced] = useState(false);
  const webgl = useHasWebGL();

  useEffect(() => {
    setReduced(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);

    const section = sectionRef.current;
    if (!section) return;

    let raf = 0;
    let queued = false;
    const measure = (): void => {
      queued = false;
      const rect = section.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      progressRef.current = total <= 0 ? 0 : Math.max(0, Math.min(1, -rect.top / total));
    };
    const onScroll = (): void => {
      if (queued) return;
      queued = true;
      raf = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <section ref={sectionRef} className="tf-section relative bg-bg" aria-labelledby="tf-heading">
      <div className="tf-stage sticky top-0 flex h-[100svh] items-center justify-center overflow-hidden">
        {/* the bubble field (WebGL) or a calm static fallback */}
        <div aria-hidden className="pointer-events-none absolute inset-0">
          {webgl ? (
            <CanvasBoundary fallback={<div className="tf-fallback absolute inset-0" />}>
              <BubbleField progressRef={progressRef} reduced={reduced} />
            </CanvasBoundary>
          ) : (
            <div className="tf-fallback absolute inset-0" />
          )}
        </div>

        {/* soft light behind the centre so the copy stays legible over the glass */}
        <div aria-hidden className="tf-veil pointer-events-none absolute inset-0" />

        {/* the message the mind surrounds — centred, calm, lots of air */}
        <div className="relative z-10 flex w-full max-w-2xl flex-col items-center px-6 text-center">
          <h2
            id="tf-heading"
            className="font-display text-balance text-[clamp(2.2rem,5vw,3.8rem)] font-600 leading-[1.0] tracking-[-0.04em] text-text"
          >
            everything it&rsquo;s thinking,
            <br className="hidden sm:block" /> while you just talk to it.
          </h2>
          <p className="mt-6 max-w-md text-pretty font-geist text-[clamp(1rem,1.5vw,1.18rem)] leading-[1.55] text-text-sec">
            One mind, always on. It reads, decides, acts. You just say what you
            want and it goes and does it.
          </p>
          <div className="mt-10 w-full max-w-[460px]">
            <AskExpand variant="light" />
          </div>
        </div>
      </div>
    </section>
  );
}
