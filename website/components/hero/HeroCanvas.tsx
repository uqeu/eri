"use client";

import type { ReactNode } from "react";

interface HeroCanvasProps {
  readonly onReset: () => void;
  readonly children: ReactNode;
}

export function HeroCanvas({ onReset, children }: HeroCanvasProps): React.ReactElement {
  return (
    <div
      className="relative w-full overflow-hidden rounded-2xl border border-border"
      style={{
        height: "min(820px, 78vh)",
        minHeight: 660,
        background:
          "radial-gradient(circle at 25% 20%, rgba(191, 215, 193, 0.10), transparent 55%), radial-gradient(circle at 80% 80%, rgba(201, 220, 234, 0.10), transparent 55%), #14120b",
      }}
    >
      {children}
      <button
        type="button"
        onClick={onReset}
        aria-label="Reset layout"
        title="Reset windows"
        className="absolute bottom-4 right-4 inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-black/40 text-white/70 hover:bg-black/55 hover:text-white"
      >
        ↻
      </button>
    </div>
  );
}
