"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Reveal-on-scroll. Returns a ref to attach to the element and a boolean that
 * flips true once the element scrolls into view (once — it doesn't re-hide).
 * Honours prefers-reduced-motion by starting shown. Mirrors the existing
 * `.rise`/`fadeUp` entrance vocabulary, no animation library needed.
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>(
  options?: { readonly rootMargin?: string; readonly threshold?: number },
): readonly [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const reduced =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (reduced || typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShown(true);
            observer.disconnect();
          }
        }
      },
      {
        rootMargin: options?.rootMargin ?? "0px 0px -12% 0px",
        threshold: options?.threshold ?? 0.2,
      },
    );

    observer.observe(el);

    // Safety net: never leave content permanently hidden if the observer never
    // fires (odd layouts, headless capture, background tabs). Reveal after 2.5s.
    const fallback = window.setTimeout(() => setShown(true), 2500);

    return () => {
      observer.disconnect();
      window.clearTimeout(fallback);
    };
  }, [options?.rootMargin, options?.threshold]);

  return [ref, shown] as const;
}
