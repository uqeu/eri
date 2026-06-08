import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
  Sequence,
  Easing,
} from "remotion";

// ── Brand palette (inline so the composition is self-contained / render-safe) ──
const C = {
  bg: "#0c0c0c",
  card: "#141414",
  card2: "#1c1c1c",
  line: "rgba(255,255,255,0.08)",
  lineStrong: "rgba(255,255,255,0.16)",
  text: "#ededed",
  sec: "rgba(237,237,237,0.6)",
  ter: "rgba(237,237,237,0.4)",
  accent: "#e0ff4f",
};
const DISPLAY = "'Funnel Display', system-ui, sans-serif";
const MONO = "'JetBrains Mono', ui-monospace, monospace";

// Timeline (frames @ 30fps). Each beat owns a window of the 300-frame loop.
const T = {
  summon: 0,
  listenStart: 18,
  listenEnd: 96,
  scanStart: 96,
  scanEnd: 150,
  stepsStart: 150,
  confirm: 248,
};

const COMMAND = "open Mail and reply to Priya";
const STEPS = [
  "Looked at the screen",
  "Opened Mail",
  "Found Priya's last email",
  "Drafting a reply…",
];
const INBOX = [
  { name: "Priya Nair", t: "9:48" },
  { name: "GitHub", t: "9:31" },
  { name: "Stripe", t: "9:12" },
  { name: "Calendar", t: "8:55" },
];

// A single animated waveform bar.
const Bar: React.FC<{ i: number; active: boolean }> = ({ i, active }) => {
  const frame = useCurrentFrame();
  const h = active
    ? 6 + Math.abs(Math.sin((frame * 0.4 + i * 0.9) * 0.7)) * 22
    : 4;
  return (
    <div
      style={{
        width: 4,
        height: h,
        borderRadius: 4,
        background: C.accent,
        opacity: active ? 1 : 0.3,
      }}
    />
  );
};

const Check: React.FC<{ progress: number }> = ({ progress }) => (
  <div
    style={{
      width: 22,
      height: 22,
      borderRadius: 999,
      border: `1.5px solid ${C.accent}`,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
    }}
  >
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
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

const Spinner: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        width: 22,
        height: 22,
        borderRadius: 999,
        border: `2px solid ${C.ter}`,
        borderTopColor: C.text,
        transform: `rotate(${frame * 18}deg)`,
        flexShrink: 0,
      }}
    />
  );
};

export const EriLoop: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  // Typewriter for the transcript.
  const typed = Math.round(
    interpolate(frame, [T.listenStart + 6, T.listenEnd - 8], [0, COMMAND.length], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  );
  const listening = frame >= T.listenStart && frame < T.scanStart;

  // Screen-scan sweep position (top→bottom of the desktop area).
  const scanY = interpolate(frame, [T.scanStart, T.scanEnd], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });
  const scanning = frame >= T.scanStart && frame < T.scanEnd;

  // Ambient glow drift.
  const glow = interpolate(Math.sin(frame / 40), [-1, 1], [0.3, 0.6]);

  return (
    <AbsoluteFill style={{ background: C.bg, fontFamily: DISPLAY }}>
      {/* Ambient radial wash + faint grid */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(60% 50% at 78% 14%, rgba(224,255,79,${
            glow * 0.12
          }) 0%, transparent 60%), radial-gradient(50% 40% at 10% 90%, rgba(237,237,237,0.04) 0%, transparent 60%)`,
        }}
      />
      <AbsoluteFill
        style={{
          backgroundImage: `linear-gradient(${C.line} 1px, transparent 1px), linear-gradient(90deg, ${C.line} 1px, transparent 1px)`,
          backgroundSize: "56px 56px",
          opacity: 0.5,
          maskImage: "radial-gradient(80% 70% at 50% 40%, #000 0%, transparent 100%)",
          WebkitMaskImage:
            "radial-gradient(80% 70% at 50% 40%, #000 0%, transparent 100%)",
        }}
      />

      {/* Desktop / Mail window */}
      <DesktopWindow scanning={scanning} scanY={scanY} width={width} height={height} />

      {/* The floating eri command bar */}
      <CommandBar
        frame={frame}
        fps={fps}
        listening={listening}
        typed={typed}
        width={width}
      />
    </AbsoluteFill>
  );
};

const DesktopWindow: React.FC<{
  scanning: boolean;
  scanY: number;
  width: number;
  height: number;
}> = ({ scanning, scanY, width }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 30 });
  const winY = interpolate(enter, [0, 1], [40, 0]);
  const winOpacity = interpolate(enter, [0, 1], [0, 1]);

  const pad = 72;
  const w = width - pad * 2;
  const winH = 430;

  return (
    <div
      style={{
        position: "absolute",
        left: pad,
        top: 70,
        width: w,
        opacity: winOpacity,
        transform: `translateY(${winY}px)`,
      }}
    >
      <div
        style={{
          borderRadius: 16,
          border: `1px solid ${C.line}`,
          background: C.card,
          overflow: "hidden",
          boxShadow:
            "0 40px 90px -30px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.04)",
          height: winH,
          position: "relative",
        }}
      >
        {/* Title bar */}
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
            Mail — Inbox
          </div>
        </div>

        {/* Inbox rows */}
        <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 12 }}>
          {INBOX.map((row, i) => {
            const isTarget = i === 0;
            // Highlight Priya's row as the scan passes it.
            const highlight = scanning && scanY > 0.18 && isTarget ? 1 : 0;
            return (
              <div
                key={row.name}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: "14px 16px",
                  borderRadius: 12,
                  border: `1px solid ${highlight ? C.accent : C.line}`,
                  background: highlight ? "rgba(224,255,79,0.06)" : "rgba(255,255,255,0.02)",
                  opacity: 0.5 + highlight * 0.5,
                }}
              >
                <div style={{ width: 34, height: 34, borderRadius: 999, background: C.card2 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, color: C.text }}>{row.name}</div>
                  <div
                    style={{
                      marginTop: 6,
                      height: 8,
                      width: "62%",
                      borderRadius: 4,
                      background: "rgba(237,237,237,0.1)",
                    }}
                  />
                </div>
                <div style={{ fontFamily: MONO, fontSize: 12, color: C.ter }}>{row.t} AM</div>
              </div>
            );
          })}
        </div>

        {/* Scan sweep line */}
        {scanning && (
          <>
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: `${10 + scanY * 80}%`,
                height: 2,
                background: `linear-gradient(90deg, transparent, ${C.accent}, transparent)`,
                boxShadow: `0 0 18px 2px rgba(224,255,79,0.5)`,
              }}
            />
            <div
              style={{
                position: "absolute",
                top: 16,
                right: 18,
                fontFamily: MONO,
                fontSize: 12,
                color: C.accent,
                opacity: interpolate(frame % 20, [0, 10, 20], [0.4, 1, 0.4]),
              }}
            >
              reading screen…
            </div>
          </>
        )}
      </div>
    </div>
  );
};

const CommandBar: React.FC<{
  frame: number;
  fps: number;
  listening: boolean;
  typed: number;
  width: number;
}> = ({ frame, fps, listening, typed, width }) => {
  // Bar rises in on summon.
  const enter = spring({ frame: frame - T.summon, fps, config: { damping: 18, stiffness: 120 } });
  const y = interpolate(enter, [0, 1], [60, 0]);
  const opacity = interpolate(enter, [0, 1], [0, 1]);

  const pad = 110;
  const visibleSteps = Math.max(
    0,
    Math.min(STEPS.length, Math.floor((frame - T.stepsStart) / 24) + 1),
  );
  const showConfirm = frame >= T.confirm;
  const confirmSpring = spring({
    frame: frame - T.confirm,
    fps,
    config: { damping: 16, stiffness: 120 },
  });

  return (
    <div
      style={{
        position: "absolute",
        left: pad,
        right: pad,
        bottom: 56,
        opacity,
        transform: `translateY(${y}px)`,
      }}
    >
      <div
        style={{
          borderRadius: 18,
          border: `1px solid ${C.lineStrong}`,
          background: "rgba(20,20,20,0.92)",
          backdropFilter: "blur(12px)",
          padding: 22,
          boxShadow: "0 30px 70px -24px rgba(0,0,0,0.9)",
        }}
      >
        {/* Top row: hotkey + state */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              display: "flex",
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
            <span style={{ color: C.text }}>⌥</span>
            <span style={{ color: C.ter }}>+</span>
            <span style={{ color: C.text }}>Space</span>
          </div>

          {listening ? (
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 28 }}>
                {Array.from({ length: 7 }).map((_, i) => (
                  <Bar key={i} i={i} active />
                ))}
              </div>
              <span style={{ fontSize: 15, color: C.sec }}>Listening…</span>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: 999,
                  background: C.accent,
                  opacity: interpolate(frame % 30, [0, 15, 30], [0.3, 1, 0.3]),
                }}
              />
              <span style={{ fontSize: 15, color: C.sec }}>eri is on it</span>
            </div>
          )}
        </div>

        {/* Transcript */}
        <div style={{ marginTop: 18, fontSize: 30, lineHeight: 1.2, color: C.text, fontWeight: 500 }}>
          “{COMMAND.slice(0, typed)}
          {listening && (
            <span
              style={{
                display: "inline-block",
                width: 3,
                height: "1em",
                background: C.text,
                transform: "translateY(4px)",
                opacity: frame % 16 < 8 ? 1 : 0,
                marginLeft: 2,
              }}
            />
          )}
          {!listening && "”"}
        </div>

        {/* Action steps */}
        <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 12 }}>
          {STEPS.slice(0, visibleSteps).map((label, i) => {
            const startF = T.stepsStart + i * 24;
            const s = spring({ frame: frame - startF, fps, config: { damping: 16 } });
            const isLast = i === STEPS.length - 1;
            const checkP = isLast
              ? 0
              : interpolate(frame - startF, [6, 20], [0, 1], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                });
            return (
              <div
                key={label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  fontSize: 18,
                  color: isLast ? C.text : C.sec,
                  opacity: s,
                  transform: `translateX(${interpolate(s, [0, 1], [-10, 0])}px)`,
                }}
              >
                {isLast ? <Spinner /> : <Check progress={checkP} />}
                {label}
              </div>
            );
          })}
        </div>

        {/* Confirm card — eri never sends silently */}
        {showConfirm && (
          <div
            style={{
              marginTop: 18,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "14px 18px",
              borderRadius: 12,
              border: `1px solid ${C.line}`,
              background: C.bg,
              opacity: confirmSpring,
              transform: `translateY(${interpolate(confirmSpring, [0, 1], [16, 0])}px)`,
            }}
          >
            <span style={{ fontSize: 16, color: C.sec }}>Send the reply?</span>
            <div style={{ display: "flex", gap: 10 }}>
              <span
                style={{
                  padding: "7px 14px",
                  borderRadius: 8,
                  border: `1px solid ${C.line}`,
                  fontFamily: MONO,
                  fontSize: 12,
                  color: C.ter,
                }}
              >
                review
              </span>
              <span
                style={{
                  padding: "7px 14px",
                  borderRadius: 8,
                  background: C.text,
                  fontFamily: MONO,
                  fontSize: 12,
                  color: C.bg,
                }}
              >
                send
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export const ERI_LOOP = {
  durationInFrames: 300,
  fps: 30,
  width: 1280,
  height: 800,
} as const;
