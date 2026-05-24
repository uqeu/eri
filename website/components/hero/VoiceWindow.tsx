"use client";

import { useEffect, useState } from "react";

const PHRASES = [
  "make the annual price chip glow when toggled",
  "tighten the headline letter-spacing",
  "give the cta button a soft halo",
  "fade the price text between monthly and annual",
] as const;

const GAZE_TARGETS = [
  { label: "Toggle.billing-cycle", file: "pricing.tsx · line 47" },
  { label: "h1.hero-headline", file: "pricing.tsx · line 12" },
  { label: "Button.cta-primary", file: "pricing.tsx · line 92" },
  { label: "Price.chip", file: "pricing.tsx · line 64" },
] as const;

const BARS = [0.3, 0.6, 0.9, 1.0, 0.7, 0.4, 0.8, 1.0, 0.6, 0.3, 0.5, 0.9, 0.7, 0.4, 0.2];

export function VoiceWindow(): React.ReactElement {
  const [phraseIdx, setPhraseIdx] = useState<number>(0);
  const [shown, setShown] = useState<string>("");
  const [tick, setTick] = useState<number>(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 130);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const target = PHRASES[phraseIdx]!;
    if (shown.length < target.length) {
      const id = setTimeout(() => setShown(target.slice(0, shown.length + 1)), 35);
      return () => clearTimeout(id);
    }
    const id = setTimeout(() => {
      setShown("");
      setPhraseIdx((i) => (i + 1) % PHRASES.length);
    }, 2200);
    return () => clearTimeout(id);
  }, [shown, phraseIdx]);

  const gaze = GAZE_TARGETS[phraseIdx]!;

  return (
    <div className="flex h-full flex-col p-3 text-[12px]">
      <div className="mb-2 text-[10px] uppercase tracking-wider text-white/45">Voice · Gaze</div>
      <div className="flex items-center gap-2">
        <span
          className="inline-flex h-2 w-2 rounded-full bg-[#e0ff4f]"
          style={{ animation: "voicePulse 1.4s ease-in-out infinite" }}
        />
        <span className="text-white/85">listening · sub-second</span>
      </div>
      <div className="mt-2 flex h-8 items-end gap-[3px]">
        {BARS.map((_, i) => {
          const phase = (tick + i) % BARS.length;
          const animated = BARS[phase]!;
          return (
            <span
              key={i}
              className="block w-[3px] rounded-full bg-[#e0ff4f]"
              style={{
                height: `${Math.max(animated, 0.15) * 100}%`,
                opacity: 0.45 + animated * 0.55,
                transition: "height 130ms ease-out, opacity 130ms ease-out",
              }}
            />
          );
        })}
      </div>
      <div className="mt-3 rounded-md border border-white/[0.08] bg-white/[0.02] p-2">
        <div className="text-[10px] uppercase tracking-wider text-white/45 mb-1">Transcript</div>
        <div className="text-white/90 min-h-[2.4em] leading-snug">
          {shown}
          <span
            className="ml-[1px] inline-block align-middle"
            style={{
              width: 1.5,
              height: "1em",
              background: "rgba(224,255,79,0.85)",
              animation: "voiceCaret 0.9s steps(1) infinite",
            }}
          />
        </div>
      </div>
      <div className="mt-2 rounded-md border border-[#e0ff4f]/40 bg-[#e0ff4f]/[0.06] p-2 transition-all">
        <div className="text-[10px] uppercase tracking-wider text-[#e0ff4f]/80 mb-1">Gaze</div>
        <div className="text-white/90">
          {gaze.label} <span className="text-white/45">· {gaze.file}</span>
        </div>
      </div>
      <div className="mt-auto text-[10px] text-white/35">local whisper · on-device</div>

      <style jsx>{`
        @keyframes voicePulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.55; transform: scale(0.85); }
        }
        @keyframes voiceCaret {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
