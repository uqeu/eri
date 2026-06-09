import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, MONO, Stage, Window, Waveform, Hotkey, typed } from "./theme";

// Dictation demo: messy spoken words land raw, then clean themselves up —
// grammar, fillers, punctuation — and a spoken "fix that word" swaps a word.
// The dig: it also spells "eri" right (the thing the competition can't).

const RAW = "um so like send priya the the deck tmrw morning and uh ask about the budget thing";
const CLEAN = "Send Priya the deck tomorrow morning, and ask about the budget.";
const FIXED = "Send Priya the proposal tomorrow morning, and ask about the budget.";

const T = { listen: 16, listenEnd: 92, clean: 100, fix: 188, fixEnd: 214 };

export const VoiceClean: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 26 });
  const listening = frame >= T.listen && frame < T.listenEnd;

  const rawOpacity = interpolate(frame, [T.listen, T.listen + 8, T.clean, T.clean + 16], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const cleanOpacity = interpolate(frame, [T.clean + 6, T.clean + 24], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const showFixed = frame >= T.fixEnd;
  const fixChip = spring({ frame: frame - T.fix, fps, config: { damping: 16 } });
  // lime underline sweep as the text is cleaned
  const sweep = interpolate(frame, [T.clean + 6, T.clean + 30], [0, 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <Stage>
      <div
        style={{
          position: "absolute",
          inset: "70px 90px",
          opacity: enter,
          transform: `translateY(${interpolate(enter, [0, 1], [30, 0])}px)`,
        }}
      >
        <Window title="Notes — Dictation" style={{ height: 660 }}>
          <div style={{ padding: 40, position: "relative", height: "100%" }}>
            {/* status row */}
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 30 }}>
              <Hotkey keys={["fn", "fn"]} />
              {listening ? (
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <Waveform active />
                  <span style={{ fontSize: 16, color: C.sec }}>Listening…</span>
                </div>
              ) : (
                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: 13,
                    color: C.accent,
                    border: `1px solid ${C.line}`,
                    borderRadius: 8,
                    padding: "6px 12px",
                  }}
                >
                  ✓ cleaned
                </span>
              )}
            </div>

            {/* RAW transcript */}
            <div
              style={{
                position: "absolute",
                left: 40,
                right: 40,
                top: 120,
                opacity: rawOpacity,
                fontSize: 30,
                lineHeight: 1.5,
                color: C.ter,
                fontFamily: MONO,
              }}
            >
              {typed(frame, RAW, T.listen + 4, T.listenEnd)}
              {listening && (
                <span style={{ opacity: frame % 16 < 8 ? 1 : 0, color: C.text }}>▍</span>
              )}
            </div>

            {/* CLEAN transcript */}
            <div
              style={{
                position: "absolute",
                left: 40,
                right: 40,
                top: 120,
                opacity: cleanOpacity,
                fontSize: 34,
                lineHeight: 1.5,
                color: C.text,
                fontWeight: 500,
              }}
            >
              {(showFixed ? FIXED : CLEAN).split(" ").map((w, i) => {
                const isFixedWord = showFixed && w === "proposal";
                return (
                  <span
                    key={`${w}-${i}`}
                    style={{
                      color: isFixedWord ? C.accent : C.text,
                      transition: "color 0.3s",
                    }}
                  >
                    {w}{" "}
                  </span>
                );
              })}
              {/* lime underline sweep */}
              <div
                style={{
                  marginTop: 14,
                  height: 2,
                  width: `${sweep}%`,
                  background: `linear-gradient(90deg, ${C.accent}, transparent)`,
                  borderRadius: 2,
                }}
              />
            </div>

            {/* "fix that word" voice chip */}
            {frame >= T.fix && (
              <div
                style={{
                  position: "absolute",
                  left: 40,
                  bottom: 120,
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 16px",
                  borderRadius: 12,
                  border: `1px solid ${C.lineStrong}`,
                  background: C.bg,
                  opacity: fixChip,
                  transform: `translateY(${interpolate(fixChip, [0, 1], [16, 0])}px)`,
                }}
              >
                <Waveform bars={5} active={frame < T.fixEnd} />
                <span style={{ fontSize: 17, color: C.sec }}>
                  “fix that word —{" "}
                  <span style={{ color: C.accent }}>deck → proposal</span>”
                </span>
              </div>
            )}

            {/* learned-vocabulary chip (the spelling dig) */}
            <div
              style={{
                position: "absolute",
                right: 40,
                bottom: 36,
                fontFamily: MONO,
                fontSize: 12,
                color: C.ter,
              }}
            >
              dictionary · learned: <span style={{ color: C.text }}>eri</span>, Priya
            </div>
          </div>
        </Window>
      </div>
    </Stage>
  );
};

export const VOICE_CLEAN = { durationInFrames: 300, fps: 30, width: 1280, height: 800 } as const;
