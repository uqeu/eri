// A clean dark "desktop" backdrop for the hero — the surface eri's floating
// assistant + terminal sit on top of (Cluely floats their card over a wallpaper;
// this is our dark/lime version). Pure backdrop: menubar + glow + dock.

const DOCK = ["#2a2a2a", "#242424", "#2e2e2e", "#262626"];

export function DesktopStage(): React.ReactElement {
  return (
    <div
      aria-hidden
      className="relative w-full overflow-hidden rounded-2xl border border-border"
      style={{
        aspectRatio: "16 / 10",
        background:
          "radial-gradient(80% 70% at 70% 0%, rgba(224,255,79,0.07) 0%, transparent 55%), radial-gradient(70% 60% at 10% 100%, rgba(255,255,255,0.04) 0%, transparent 60%), #0a0a0a",
        boxShadow: "0 50px 120px -40px rgba(0,0,0,0.9), inset 0 1px 0 rgba(255,255,255,0.04)",
      }}
    >
      {/* faint grid */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage: "radial-gradient(90% 80% at 50% 30%, #000, transparent 100%)",
          WebkitMaskImage: "radial-gradient(90% 80% at 50% 30%, #000, transparent 100%)",
        }}
      />
      {/* menubar */}
      <div className="absolute inset-x-0 top-0 flex items-center justify-between px-4 py-2 text-white/45">
        <div className="flex items-center gap-4 font-mono text-[11px]">
          <span className="font-display text-[13px] text-white/70" style={{ letterSpacing: "-0.05em" }}>
            eri
          </span>
          <span className="hidden sm:inline">File</span>
          <span className="hidden sm:inline">Edit</span>
          <span className="hidden sm:inline">View</span>
        </div>
        <div className="flex items-center gap-3 font-mono text-[11px]">
          <span className="hidden sm:inline">⌥␣</span>
          <span>9:41</span>
        </div>
      </div>

      {/* dock */}
      <div className="absolute inset-x-0 bottom-4 flex justify-center">
        <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-2 py-1.5 backdrop-blur-md">
          {DOCK.map((c, i) => (
            <div key={i} className="size-8 rounded-[9px]" style={{ background: c }} />
          ))}
          <div className="mx-1 h-7 w-px rounded-full bg-white/15" />
          {/* eri tile */}
          <div
            className="flex size-8 items-center justify-center rounded-[9px] font-display text-[13px] text-bg"
            style={{ background: "linear-gradient(180deg,#e0ff4f,#cdee3a)", letterSpacing: "-0.05em" }}
          >
            e
          </div>
        </div>
      </div>
    </div>
  );
}
