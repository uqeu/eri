interface Frame {
  label: string;
  caption: string;
  body: React.ReactElement;
}

function VoiceWaveform(): React.ReactElement {
  const bars = [0.3, 0.7, 0.45, 0.95, 0.6, 0.85, 0.4, 0.75, 0.55, 0.9, 0.35, 0.65];
  return (
    <div className="flex h-24 items-end justify-center gap-1.5">
      {bars.map((peak, i) => (
        <span
          key={i}
          className="block w-1.5 origin-bottom rounded-full bg-accent"
          style={{
            height: `${peak * 100}%`,
            animation: `wave 1.4s ease-in-out ${i * 0.07}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

function ThinkingDots(): React.ReactElement {
  return (
    <div className="flex h-24 items-center justify-center gap-2.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="block h-3 w-3 rounded-full bg-accent"
          style={{
            animation: `pulseDot 1.4s ease-in-out ${i * 0.2}s infinite`,
          }}
        />
      ))}
      <span className="ml-3 font-mono text-[11px] uppercase tracking-[0.2em] text-muted">
        eri Engine
      </span>
    </div>
  );
}

function FinishedPage(): React.ReactElement {
  return (
    <div className="h-24 rounded-md border border-white/10 bg-ink/60 p-3">
      <div className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-red-400/70" />
        <span className="h-2 w-2 rounded-full bg-yellow-300/70" />
        <span className="h-2 w-2 rounded-full bg-green-400/70" />
        <span className="ml-2 font-mono text-[10px] text-muted">coffee.eri.app</span>
      </div>
      <div className="mt-3 space-y-1.5">
        <div className="h-2 w-3/4 rounded bg-paper/30" />
        <div className="h-2 w-1/2 rounded bg-paper/20" />
        <div className="mt-2 flex gap-1.5">
          <div className="h-6 w-12 rounded bg-accent/80" />
          <div className="h-6 w-12 rounded border border-white/10" />
        </div>
      </div>
    </div>
  );
}

const FRAMES: ReadonlyArray<Frame> = [
  {
    label: "01 · Talk",
    caption: '"Build me a coffee shop landing."',
    body: <VoiceWaveform />,
  },
  {
    label: "02 · Watch",
    caption: "The eri Engine diffuses the diff in 1.8s.",
    body: <ThinkingDots />,
  },
  {
    label: "03 · Ship",
    caption: "Live URL in 28s. Pushed to Vercel.",
    body: <FinishedPage />,
  },
];

export function LiveDemoStrip(): React.ReactElement {
  return (
    <section className="border-t border-white/[0.08]">
      <div className="mx-auto max-w-7xl px-6 py-24 sm:py-28">
        <div className="flex items-end justify-between gap-6 flex-wrap">
          <div>
            <p className="mono-cap text-paper/40">Live capture</p>
            <h2 className="mt-5 font-display text-h2 max-w-2xl text-balance font-normal">
              What every iteration{" "}
              <span className="italic accent-shimmer">looks like.</span>
            </h2>
          </div>
          <div className="mono-cap text-paper/40">
            ~3.8s total · local-first
          </div>
        </div>

        <div className="mt-14 grid gap-4 md:grid-cols-3">
          {FRAMES.map((frame) => (
            <div
              key={frame.label}
              className="relative rounded-lg border border-white/[0.08] bg-white/[0.02] p-6 card-lift"
            >
              <div className="mono-cap text-paper/40">{frame.label}</div>
              <div className="mt-6 flex h-24 items-center justify-center">
                {frame.body}
              </div>
              <p className="mt-6 font-display text-lg text-paper/90 text-balance font-normal">
                {frame.caption}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
