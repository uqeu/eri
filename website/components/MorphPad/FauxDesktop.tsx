// The colourful "desktop" that lives BEHIND the glass pad so the frosted
// backdrop-filter has a real, saturated world to blur — the Cluely/visionOS
// read where you see your machine through eri. Contained to the morph stage;
// the rest of the site stays dark and restrained.
export function FauxDesktop(): React.ReactElement {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* saturated colour field — the "wallpaper" the glass refracts */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 90% at 12% -10%, #1b3a8f 0%, transparent 45%)," +
            "radial-gradient(110% 80% at 95% 5%, #7a1f6b 0%, transparent 42%)," +
            "radial-gradient(120% 100% at 80% 100%, #0c5d57 0%, transparent 50%)," +
            "radial-gradient(90% 70% at 28% 95%, #b6471a 0%, transparent 48%)," +
            "#07070b",
        }}
      />
      {/* faux app windows — give the glass edges something to bend */}
      {WINDOWS.map((w, i) => (
        <div
          key={i}
          className="absolute rounded-[14px] border border-white/12"
          style={{
            ...w,
            background: "rgba(255,255,255,0.06)",
            boxShadow: "0 30px 80px -30px rgba(0,0,0,0.6)",
          }}
        >
          <div className="flex h-[26px] items-center gap-1.5 rounded-t-[14px] border-b border-white/10 bg-white/[0.07] px-3">
            <span className="size-2 rounded-full bg-[#ff5f57]" />
            <span className="size-2 rounded-full bg-[#febc2e]" />
            <span className="size-2 rounded-full bg-[#28c840]" />
          </div>
        </div>
      ))}
      {/* fade the desktop into the page bg at the section edges */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(140% 120% at 50% 45%, transparent 38%, rgba(12,12,12,0.55) 72%, #0c0c0c 100%)",
        }}
      />
    </div>
  );
}

const WINDOWS: ReadonlyArray<React.CSSProperties> = [
  { top: "6%", left: "5%", width: "30%", height: "42%" },
  { top: "48%", left: "16%", width: "26%", height: "38%" },
  { top: "10%", right: "6%", width: "32%", height: "54%" },
  { bottom: "5%", right: "13%", width: "24%", height: "30%" },
];
