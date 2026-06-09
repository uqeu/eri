import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, MONO, Stage, Window } from "./theme";

// Memory demo: eri keeps a private, on-device memory of how you work and
// anticipates the next thing — the personalization story.

const MEMORIES = [
  { k: "preference", v: "Prefers dark mode, lime accent" },
  { k: "habit", v: "Ships on Fridays" },
  { k: "person", v: "Priya — designer, replies fast" },
  { k: "routine", v: "Opens Linear after standup" },
];

const T = { cards: 30, stagger: 18, prompt: 150 };

const Lock: React.FC = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth={2}>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
);

export const MemoryRecall: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 26 });
  const promptSpring = spring({ frame: frame - T.prompt, fps, config: { damping: 16 } });
  const accept = frame >= T.prompt + 70;

  return (
    <Stage>
      <div
        style={{
          position: "absolute",
          inset: "70px 160px",
          opacity: enter,
          transform: `translateY(${interpolate(enter, [0, 1], [30, 0])}px)`,
        }}
      >
        <Window title="eri — Memory" style={{ height: 660 }}>
          <div style={{ padding: 40, height: "100%", position: "relative" }}>
            {/* header */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 30 }}>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 12px",
                  borderRadius: 999,
                  border: `1px solid ${C.line}`,
                  fontFamily: MONO,
                  fontSize: 12,
                  color: C.accent,
                }}
              >
                <Lock /> on-device
              </span>
              <span style={{ color: C.ter, fontSize: 15 }}>
                what eri has learned about how you work
              </span>
            </div>

            {/* memory cards */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              {MEMORIES.map((m, i) => {
                const s = spring({
                  frame: frame - (T.cards + i * T.stagger),
                  fps,
                  config: { damping: 18 },
                });
                return (
                  <div
                    key={m.v}
                    style={{
                      padding: "18px 20px",
                      borderRadius: 12,
                      border: `1px solid ${C.line}`,
                      background: "rgba(255,255,255,0.02)",
                      opacity: s,
                      transform: `translateY(${interpolate(s, [0, 1], [16, 0])}px)`,
                    }}
                  >
                    <div style={{ fontFamily: MONO, fontSize: 11, color: C.ter, textTransform: "uppercase", letterSpacing: 1 }}>
                      {m.k}
                    </div>
                    <div style={{ marginTop: 8, fontSize: 19, color: C.text }}>{m.v}</div>
                  </div>
                );
              })}
            </div>

            {/* anticipation prompt */}
            {frame >= T.prompt && (
              <div
                style={{
                  position: "absolute",
                  left: 40,
                  right: 40,
                  bottom: 36,
                  padding: "22px 24px",
                  borderRadius: 14,
                  border: `1px solid ${C.accent}`,
                  background: "rgba(224,255,79,0.06)",
                  display: "flex",
                  alignItems: "center",
                  gap: 20,
                  opacity: promptSpring,
                  transform: `translateY(${interpolate(promptSpring, [0, 1], [24, 0])}px)`,
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: MONO, fontSize: 11, color: C.accent, letterSpacing: 1 }}>
                    ERI ANTICIPATES
                  </div>
                  <div style={{ marginTop: 8, fontSize: 24, color: C.text, fontWeight: 500 }}>
                    You usually open Linear after standup — want me to?
                  </div>
                </div>
                <div style={{ display: "flex", gap: 12 }}>
                  <span
                    style={{
                      padding: "10px 18px",
                      borderRadius: 10,
                      border: `1px solid ${C.line}`,
                      fontSize: 15,
                      color: C.sec,
                    }}
                  >
                    not now
                  </span>
                  <span
                    style={{
                      padding: "10px 18px",
                      borderRadius: 10,
                      background: accept ? C.accent : C.text,
                      color: C.bg,
                      fontSize: 15,
                      fontWeight: 600,
                      transform: `scale(${accept ? 1.04 : 1})`,
                    }}
                  >
                    {accept ? "opening Linear ✓" : "open it"}
                  </span>
                </div>
              </div>
            )}
          </div>
        </Window>
      </div>
    </Stage>
  );
};

export const MEMORY_RECALL = { durationInFrames: 300, fps: 30, width: 1280, height: 800 } as const;
