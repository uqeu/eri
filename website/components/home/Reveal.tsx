"use client";

import { useEffect, useRef, useState } from "react";

// Scroll-reveal: fades + lifts its children in when they enter the viewport
// (IntersectionObserver, so it fires reliably — including in headless capture,
// unlike CSS scroll-timeline). The `.in` class lands the element at its visible
// resting state regardless of whether the transition is seen, so it never ships
// blank. Reduced-motion shows everything immediately.
export function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  readonly children: React.ReactNode;
  readonly delay?: number;
  readonly className?: string;
}): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setShown(true);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.18, rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`reveal${shown ? " in" : ""} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}
