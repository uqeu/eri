import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, MONO, Stage, Window, Check, Spinner, typed } from "./theme";

// Coding demo: a prompt becomes code via diffusion (lines denoise from blur into
// a green diff), tests pass, and it ships — the coding-agent half of eri.

const PROMPT = "add a dark-mode toggle to the header";
const CONTEXT = [
  "export function Header() {",
  "  return (",
  "    <nav className=\"flex items-center\">",
];
const ADDED = [
  "      <ThemeToggle />",
];
const CONTEXT2 = ["    </nav>", "  );", "}"];

const T = { prompt: 18, promptEnd: 70, diffuse: 80, diffuseEnd: 140, test: 150, pass: 196, ship: 220 };

const Line: React.FC<{ text: string; added?: boolean; denoise?: number }> = ({
  text,
  added,
  denoise = 1,
}) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 14,
      padding: "3px 14px",
      borderRadius: 6,
      background: added ? `rgba(130,240,130,${0.14 * denoise})` : "transparent",
      boxShadow: added ? `inset 3px 0 0 rgba(130,240,130,${denoise})` : "none",
      filter: `blur(${(1 - denoise) * 7}px)`,
      opacity: added ? denoise : 1,
    }}
  >
    <span style={{ width: 16, color: added ? C.green : C.ter, fontSize: 15 }}>
      {added ? "+" : ""}
    </span>
    <span
      style={{
        fontFamily: MONO,
        fontSize: 17,
        color: added ? C.green : C.sec,
        whiteSpace: "pre",
      }}
    >
      {text}
    </span>
  </div>
);

export const BuildCode: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 26 });

  const denoise = interpolate(frame, [T.diffuse, T.diffuseEnd], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const showAdded = frame >= T.diffuse;
  const testing = frame >= T.test && frame < T.pass;
  const passed = frame >= T.pass;
  const shipped = frame >= T.ship;
  const shipSpring = spring({ frame: frame - T.ship, fps, config: { damping: 16 } });

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
        <Window title="eri — Header.tsx" style={{ height: 660 }}>
          <div style={{ padding: 28, height: "100%", display: "flex", flexDirection: "column" }}>
            {/* prompt bar */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 16px",
                borderRadius: 10,
                border: `1px solid ${C.lineStrong}`,
                background: C.bg,
                marginBottom: 22,
              }}
            >
              <span style={{ color: C.accent, fontFamily: MONO, fontSize: 15 }}>eri ›</span>
              <span style={{ fontSize: 18, color: C.text }}>
                {typed(frame, PROMPT, T.prompt, T.promptEnd)}
                {frame < T.promptEnd && (
                  <span style={{ opacity: frame % 16 < 8 ? 1 : 0 }}>▍</span>
                )}
              </span>
            </div>

            {/* code */}
            <div style={{ flex: 1 }}>
              {CONTEXT.map((l, i) => (
                <Line key={`c${i}`} text={l} />
              ))}
              {showAdded &&
                ADDED.map((l, i) => <Line key={`a${i}`} text={l} added denoise={denoise} />)}
              {CONTEXT2.map((l, i) => (
                <Line key={`c2${i}`} text={l} />
              ))}
            </div>

            {/* terminal / status strip */}
            <div
              style={{
                marginTop: 18,
                padding: "14px 18px",
                borderRadius: 10,
                border: `1px solid ${C.line}`,
                background: "#0a0a0a",
                fontFamily: MONO,
                fontSize: 15,
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              {!testing && !passed && (
                <span style={{ color: C.ter }}>$ ready</span>
              )}
              {testing && (
                <>
                  <Spinner size={18} />
                  <span style={{ color: C.sec }}>$ npm test — running…</span>
                </>
              )}
              {passed && (
                <>
                  <Check size={18} />
                  <span style={{ color: C.green }}>12 passed</span>
                  {shipped && (
                    <span
                      style={{
                        marginLeft: "auto",
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        color: C.accent,
                        opacity: shipSpring,
                        transform: `translateX(${interpolate(shipSpring, [0, 1], [12, 0])}px)`,
                      }}
                    >
                      shipped → eri.app/preview ✓
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
        </Window>
      </div>
    </Stage>
  );
};

export const BUILD_CODE = { durationInFrames: 300, fps: 30, width: 1280, height: 800 } as const;
