"use client";

import { useState } from "react";
import { GripVertical } from "lucide-react";

// A draggable before/after comparison wipe (clip-path technique). `base` fills
// the frame; `top` is revealed on the LEFT of the handle. Drag (mouse or touch)
// to wipe between them. Adapted from the common 21st.dev image-comparison
// pattern, but renders live React scenes instead of static images.

export function CompareSlider({
  base,
  top,
  leftLabel,
  rightLabel,
  className,
}: {
  readonly base: React.ReactNode; // shown on the RIGHT side
  readonly top: React.ReactNode; // shown on the LEFT side
  readonly leftLabel?: string;
  readonly rightLabel?: string;
  readonly className?: string;
}): React.ReactElement {
  const [inset, setInset] = useState(50);
  const [down, setDown] = useState(false);

  const onMove = (e: React.MouseEvent | React.TouchEvent): void => {
    if (!down) return;
    const rect = e.currentTarget.getBoundingClientRect();
    let x = 0;
    if ("touches" in e && e.touches.length > 0) {
      x = e.touches[0].clientX - rect.left;
    } else if ("clientX" in e) {
      x = (e as React.MouseEvent).clientX - rect.left;
    }
    const pct = Math.max(2, Math.min(98, (x / rect.width) * 100));
    setInset(pct);
  };

  return (
    <div
      className={`relative select-none overflow-hidden rounded-[28px] ${className ?? ""}`}
      onMouseMove={onMove}
      onMouseUp={() => setDown(false)}
      onMouseLeave={() => setDown(false)}
      onTouchMove={onMove}
      onTouchEnd={() => setDown(false)}
    >
      {/* base = right side */}
      <div className="absolute inset-0">{base}</div>

      {/* top = left side, clipped to the left of the handle */}
      <div
        className="absolute inset-0"
        style={{ clipPath: `inset(0 ${100 - inset}% 0 0)` }}
      >
        {top}
      </div>

      {/* labels */}
      {leftLabel && (
        <span
          className="pointer-events-none absolute left-4 top-4 z-20 rounded-full bg-[#1c1a17]/80 px-3 py-1 font-geist-mono text-[10px] uppercase tracking-[0.16em] text-white backdrop-blur-sm transition-opacity duration-200"
          style={{ opacity: inset > 16 ? 1 : 0 }}
        >
          {leftLabel}
        </span>
      )}
      {rightLabel && (
        <span
          className="pointer-events-none absolute right-4 top-4 z-20 rounded-full bg-[#1c1a17]/80 px-3 py-1 font-geist-mono text-[10px] uppercase tracking-[0.16em] text-white backdrop-blur-sm transition-opacity duration-200"
          style={{ opacity: inset < 84 ? 1 : 0 }}
        >
          {rightLabel}
        </span>
      )}

      {/* the handle */}
      <div
        className="absolute bottom-0 top-0 z-30 -ml-px w-[2px] bg-white/85"
        style={{ left: `${inset}%`, boxShadow: "0 0 0 1px rgba(28,26,23,0.10)" }}
      >
        <button
          type="button"
          aria-label="Drag to compare your Mac and your phone"
          className="absolute top-1/2 -ml-[19px] flex size-10 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-full bg-white text-[#1c1a17] shadow-[0_2px_12px_rgba(28,26,23,0.28)] transition-transform hover:scale-105"
          onMouseDown={(e) => {
            setDown(true);
            onMove(e);
          }}
          onMouseUp={() => setDown(false)}
          onTouchStart={(e) => {
            setDown(true);
            onMove(e);
          }}
          onTouchEnd={() => setDown(false)}
        >
          <GripVertical className="size-4" />
        </button>
      </div>
    </div>
  );
}
