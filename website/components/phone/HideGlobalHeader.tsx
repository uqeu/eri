"use client";

import { useEffect } from "react";

// The root layout mounts a global dark `SiteHeader` before page content, and it
// only suppresses itself on "/" and dashboard routes. This page renders the
// homepage's own `HomeHeader` instead, so the global one would be a duplicate
// stacked on top. We can't edit SiteHeader or the root layout, so this tiny
// client effect hides the global header element for this route only and
// restores it on unmount. It targets the sibling that sits directly before this
// page's wrapper in the body, which is exactly the SiteHeader container.
export function HideGlobalHeader(): null {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".theme-light");
    const prev = root?.previousElementSibling as HTMLElement | null;
    // Only hide a header-like sticky banner, never something unexpected.
    if (!prev || prev.querySelector("header") === null) return;

    const prevDisplay = prev.style.display;
    prev.style.display = "none";
    return () => {
      prev.style.display = prevDisplay;
    };
  }, []);

  return null;
}
