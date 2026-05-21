export function DemoEmbed(): React.ReactElement {
  return (
    <section id="demo" className="border-t border-white/[0.08]">
      <div className="mx-auto max-w-6xl px-6 py-24 sm:py-32">
        <p className="mono-cap text-paper/40">See it move</p>
        <h2 className="mt-5 font-display text-h2 max-w-2xl text-balance font-normal">
          A two-minute look at eri{" "}
          <span className="italic accent-shimmer">in flight.</span>
        </h2>

        <div className="mt-12 relative aspect-video w-full rounded-lg overflow-hidden border border-white/[0.08] bg-white/[0.02]">
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
            <div
              className="flex h-16 w-16 items-center justify-center rounded-full border border-accent/40 bg-ink/80 text-accent text-2xl"
              aria-hidden
            >
              ▶
            </div>
            <div className="font-display text-2xl text-paper font-normal">
              Demo coming soon
            </div>
            <p className="text-[15px] text-paper/55 max-w-md text-center px-6">
              We&apos;re polishing the cut. Drop your email below and
              we&apos;ll ping you the second it goes live.
            </p>
          </div>
          <div
            className="absolute inset-0 pointer-events-none opacity-30"
            aria-hidden
            style={{
              background:
                "radial-gradient(60% 50% at 50% 50%, rgba(224,255,79,0.10) 0%, transparent 70%)",
            }}
          />
        </div>
      </div>
    </section>
  );
}
