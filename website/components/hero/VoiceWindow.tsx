"use client";

export function VoiceWindow(): React.ReactElement {
  return (
    <div className="flex h-full flex-col p-3 text-[12px]">
      <div className="mb-2 text-[10px] uppercase tracking-wider text-white/45">Voice · Gaze</div>
      <div className="flex items-center gap-2">
        <span className="inline-flex h-2 w-2 rounded-full bg-[#e0ff4f]" />
        <span className="text-white/85">listening · sub-second</span>
      </div>
      <div className="mt-2 flex h-8 items-center gap-[3px]">
        {[0.3, 0.6, 0.9, 1.0, 0.7, 0.4, 0.8, 1.0, 0.6, 0.3, 0.5, 0.9, 0.7, 0.4, 0.2].map((s, i) => (
          <span key={i} className="block w-[3px] rounded-full bg-[#e0ff4f]" style={{ height: `${s * 100}%`, opacity: 0.5 + s * 0.5 }} />
        ))}
      </div>
      <div className="mt-3 rounded-md border border-white/[0.08] bg-white/[0.02] p-2">
        <div className="text-[10px] uppercase tracking-wider text-white/45 mb-1">Transcript</div>
        <div className="text-white/90">make the annual price chip glow when toggled</div>
      </div>
      <div className="mt-2 rounded-md border border-[#e0ff4f]/40 bg-[#e0ff4f]/[0.06] p-2">
        <div className="text-[10px] uppercase tracking-wider text-[#e0ff4f]/80 mb-1">Gaze</div>
        <div className="text-white/90">Toggle.billing-cycle <span className="text-white/45">· pricing.tsx · line 47</span></div>
      </div>
      <div className="mt-auto text-[10px] text-white/35">local whisper · on-device</div>
    </div>
  );
}
