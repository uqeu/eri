import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig, Easing } from "remotion";
import { C, MONO, Stage, Window, Waveform } from "./theme";

// Gaze demo: an eye-tracking ring drifts across the UI, locks onto the element
// you're looking at, and a spoken "click this" resolves the target and acts.

const T = { drift: 22, lock: 86, click: 118, done: 150 };
// Coordinates are relative to the window content box (padding 36). The Publish
// button sits in the toolbar below the 360px canvas: y ≈ 36 + 360 + 28 + 24.
const TARGET = { x: 952, y: 452 };
const START = { x: 330, y: 180 };

export const GazeAct: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 26 });

  const p = interpolate(frame, [T.drift, T.lock], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });
  const gx = interpolate(p, [0, 1], [START.x, TARGET.x]);
  const gy = interpolate(p, [0, 1], [START.y, TARGET.y]);
  const locked = frame >= T.lock;
  const pressed = frame >= T.click && frame < T.click + 12;
  const done = frame >= T.done;

  // pulsing lock ring
  const pulse = interpolate(Math.sin((frame - T.lock) / 4), [-1, 1], [0.4, 1]);

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
        <Window title="studio.eri.app — Prototype" style={{ height: 660 }}>
          <div style={{ position: "relative", height: "100%", padding: 36 }}>
            {/* faux canvas */}
            <div
              style={{
                height: 360,
                borderRadius: 12,
                border: `1px solid ${C.line}`,
                background:
                  "linear-gradient(135deg, rgba(224,255,79,0.05), rgba(255,255,255,0.02))",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: C.ter,
                fontSize: 18,
              }}
            >
              your design
            </div>

            {/* toolbar with the target button */}
            <div
              style={{
                marginTop: 28,
                display: "flex",
                justifyContent: "flex-end",
                gap: 14,
                alignItems: "center",
              }}
            >
              <span style={{ color: C.ter, fontSize: 16, marginRight: "auto" }}>
                Ready to share
              </span>
              <button
                style={{
                  padding: "12px 20px",
                  borderRadius: 10,
                  border: `1px solid ${C.line}`,
                  background: "transparent",
                  color: C.sec,
                  fontSize: 16,
                }}
              >
                Export
              </button>
              {/* PUBLISH — the gaze target */}
              <button
                style={{
                  padding: "12px 24px",
                  borderRadius: 10,
                  border: `1px solid ${locked ? C.accent : C.lineStrong}`,
                  background: done
                    ? "rgba(224,255,79,0.14)"
                    : pressed
                      ? "rgba(224,255,79,0.22)"
                      : C.text,
                  color: done ? C.accent : pressed ? C.text : C.bg,
                  fontSize: 16,
                  fontWeight: 600,
                  transform: `scale(${pressed ? 0.94 : 1})`,
                  boxShadow: locked && !done ? `0 0 0 4px rgba(224,255,79,0.15)` : "none",
                }}
              >
                {done ? "Published ✓" : "Publish"}
              </button>
            </div>

            {/* press ripple */}
            {frame >= T.click && frame < T.click + 22 && (
              <div
                style={{
                  position: "absolute",
                  left: TARGET.x,
                  top: TARGET.y,
                  width: 10,
                  height: 10,
                  borderRadius: 999,
                  border: `2px solid ${C.accent}`,
                  transform: `translate(-50%,-50%) scale(${interpolate(
                    frame - T.click,
                    [0, 22],
                    [1, 9],
                    { extrapolateRight: "clamp" },
                  )})`,
                  opacity: interpolate(frame - T.click, [0, 22], [0.7, 0], {
                    extrapolateRight: "clamp",
                  }),
                }}
              />
            )}

            {/* gaze ring */}
            {!done && (
              <div
                style={{
                  position: "absolute",
                  left: gx,
                  top: gy,
                  width: 64,
                  height: 64,
                  borderRadius: 999,
                  border: `2px solid ${C.accent}`,
                  transform: `translate(-50%,-50%) scale(${locked ? 0.7 + pulse * 0.15 : 1})`,
                  boxShadow: `0 0 24px 4px rgba(224,255,79,${locked ? 0.4 : 0.2})`,
                  opacity: 0.5 + (locked ? pulse * 0.5 : 0.3),
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    margin: "auto",
                    width: 6,
                    height: 6,
                    borderRadius: 999,
                    background: C.accent,
                  }}
                />
              </div>
            )}

            {/* gaze label */}
            <div
              style={{
                position: "absolute",
                left: gx + 40,
                top: gy - 10,
                fontFamily: MONO,
                fontSize: 12,
                color: C.accent,
                opacity: done ? 0 : 0.9,
              }}
            >
              {locked ? "locked" : "tracking gaze"}
            </div>

            {/* voice chip */}
            {locked && !done && (
              <div
                style={{
                  position: "absolute",
                  left: 36,
                  bottom: 28,
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 16px",
                  borderRadius: 12,
                  border: `1px solid ${C.lineStrong}`,
                  background: C.bg,
                }}
              >
                <Waveform bars={5} active={frame < T.click} />
                <span style={{ fontSize: 17, color: C.sec }}>“click this”</span>
              </div>
            )}
          </div>
        </Window>
      </div>
    </Stage>
  );
};

export const GAZE_ACT = { durationInFrames: 240, fps: 30, width: 1280, height: 800 } as const;
