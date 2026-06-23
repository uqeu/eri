"use client";

import { useEffect, useState } from "react";
import { Sun, PenLine, MessageSquare, RotateCcw } from "lucide-react";
import { OverlayPill, OverlayPanel, OverlayAskbar } from "./OverlayShell";

// The hero showpiece: the real eri pill that pulls itself up into the full eri
// panel when you Ask — the exact app gesture, in the exact app skin (dark
// frosted glass, lime accent), translated 1:1 from apps/eri-agent-manager.
// Opens on click; reduced-motion stays expanded.

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function AskExpand({ variant }: { readonly variant?: "dark" | "light" } = {}): React.ReactElement {
  const [open, setOpen] = useState(true); // SSR-safe: render expanded for no-JS

  useEffect(() => {
    setOpen(prefersReducedMotion());
  }, []);

  return (
    <div className="eov eov-light w-full max-w-[460px]">
      <button
        type="button"
        className="w-full cursor-pointer bg-transparent"
        aria-expanded={open}
        aria-label={open ? "Collapse eri" : "Ask eri"}
        onClick={() => setOpen((o) => !o)}
      >
        <OverlayPill listening={open} />
      </button>

      <div
        style={{
          display: "grid",
          gridTemplateRows: open ? "1fr" : "0fr",
          opacity: open ? 1 : 0,
          marginTop: open ? 10 : 0,
          transition:
            "grid-template-rows 420ms cubic-bezier(0.16,1,0.3,1), opacity 320ms ease, margin-top 420ms cubic-bezier(0.16,1,0.3,1)",
        }}
        aria-hidden={!open}
      >
        <div style={{ overflow: "hidden", minHeight: 0 }}>
          <OverlayPanel entering={false}>
            <p className="eov-answer">
              A discounted cash flow values a company on its future free cash
              flows, discounted back to today at its cost of capital.
              <span className="quiet"> From the slide on your screen.</span>
            </p>
            <div className="eov-chips">
              <span className="eov-chip">
                <Sun size={14} strokeWidth={2} />
                Assist
              </span>
              <span className="eov-chip-dot">·</span>
              <span className="eov-chip">
                <PenLine size={14} strokeWidth={2} />
                What to say
              </span>
              <span className="eov-chip-dot">·</span>
              <span className="eov-chip">
                <MessageSquare size={14} strokeWidth={2} />
                Follow-ups
              </span>
              <span className="eov-chip-dot">·</span>
              <span className="eov-chip">
                <RotateCcw size={14} strokeWidth={2} />
                Recap
              </span>
            </div>
            <OverlayAskbar />
          </OverlayPanel>
        </div>
      </div>
    </div>
  );
}
