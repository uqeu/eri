import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { loadFont as loadDisplay } from "@remotion/google-fonts/FunnelDisplay";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";

// Shared brand theme + visual primitives for every eri demo composition.
// Inline styles only, so each composition renders identically in the live
// @remotion/player and in headless PNG/MP4 renders.

export const { fontFamily: DISPLAY } = loadDisplay();
export const { fontFamily: MONO } = loadMono();

export const C = {
  bg: "#0c0c0c",
  card: "#141414",
  card2: "#1c1c1c",
  line: "rgba(255,255,255,0.08)",
  lineStrong: "rgba(255,255,255,0.16)",
  text: "#ededed",
  sec: "rgba(237,237,237,0.6)",
  ter: "rgba(237,237,237,0.4)",
  accent: "#e0ff4f",
  green: "#82f082",
} as const;

// Standard demo dimensions (16:10).
export const DIM = { width: 1280, height: 800, fps: 30 } as const;

/** Full-bleed dark stage: base bg + ambient wash + faint masked grid. */
export const Stage: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const frame = useCurrentFrame();
  const glow = interpolate(Math.sin(frame / 40), [-1, 1], [0.3, 0.6]);
  return (
    <AbsoluteFill style={{ background: C.bg, fontFamily: DISPLAY }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(60% 50% at 80% 12%, rgba(224,255,79,${
            glow * 0.1
          }) 0%, transparent 60%), radial-gradient(50% 40% at 8% 92%, rgba(237,237,237,0.04) 0%, transparent 60%)`,
        }}
      />
      <AbsoluteFill
        style={{
          backgroundImage: `linear-gradient(${C.line} 1px, transparent 1px), linear-gradient(90deg, ${C.line} 1px, transparent 1px)`,
          backgroundSize: "56px 56px",
          opacity: 0.45,
          maskImage: "radial-gradient(80% 70% at 50% 40%, #000 0%, transparent 100%)",
          WebkitMaskImage:
            "radial-gradient(80% 70% at 50% 40%, #000 0%, transparent 100%)",
        }}
      />
      {children}
    </AbsoluteFill>
  );
};

/** macOS window chrome with a title-bar label. */
export const Window: React.FC<{
  title: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}> = ({ title, style, children }) => (
  <div
    style={{
      borderRadius: 16,
      border: `1px solid ${C.line}`,
      background: C.card,
      overflow: "hidden",
      boxShadow:
        "0 40px 90px -30px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.04)",
      ...style,
    }}
  >
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "14px 18px",
        borderBottom: `1px solid ${C.line}`,
      }}
    >
      {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
        <div key={c} style={{ width: 12, height: 12, borderRadius: 999, background: c }} />
      ))}
      <div style={{ marginLeft: 10, fontFamily: MONO, fontSize: 13, color: C.ter }}>
        {title}
      </div>
    </div>
    {children}
  </div>
);

/** Draw-on lime checkmark; `progress` 0→1 draws the tick. */
export const Check: React.FC<{ progress?: number; size?: number }> = ({
  progress = 1,
  size = 22,
}) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: 999,
      border: `1.5px solid ${C.accent}`,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
    }}
  >
    <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24" fill="none">
      <path
        d="M5 12l5 5L20 6"
        stroke={C.accent}
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={28}
        strokeDashoffset={28 - 28 * progress}
      />
    </svg>
  </div>
);

/** Indeterminate spinner that rotates with the frame. */
export const Spinner: React.FC<{ size?: number }> = ({ size = 22 }) => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        border: `2px solid ${C.ter}`,
        borderTopColor: C.text,
        transform: `rotate(${frame * 18}deg)`,
        flexShrink: 0,
      }}
    />
  );
};

/** Lime voice-waveform; `active` animates the bars, otherwise flat. */
export const Waveform: React.FC<{ bars?: number; active: boolean }> = ({
  bars = 7,
  active,
}) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 28 }}>
      {Array.from({ length: bars }).map((_, i) => {
        const h = active
          ? 6 + Math.abs(Math.sin((frame * 0.4 + i * 0.9) * 0.7)) * 22
          : 4;
        return (
          <div
            key={i}
            style={{
              width: 4,
              height: h,
              borderRadius: 4,
              background: C.accent,
              opacity: active ? 1 : 0.3,
            }}
          />
        );
      })}
    </div>
  );
};

/** Hotkey chip, e.g. ⌥ + Space. */
export const Hotkey: React.FC<{ keys: string[] }> = ({ keys }) => (
  <div
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      padding: "7px 12px",
      borderRadius: 10,
      border: `1px solid ${C.line}`,
      background: C.bg,
      fontFamily: MONO,
      fontSize: 14,
      color: C.sec,
    }}
  >
    {keys.map((k, i) => (
      <React.Fragment key={k}>
        {i > 0 && <span style={{ color: C.ter }}>+</span>}
        <span style={{ color: C.text }}>{k}</span>
      </React.Fragment>
    ))}
  </div>
);

/** Typewriter helper: characters revealed across a frame window. */
export const typed = (
  frame: number,
  text: string,
  start: number,
  end: number,
): string => {
  const n = Math.round(
    interpolate(frame, [start, end], [0, text.length], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  );
  return text.slice(0, n);
};
