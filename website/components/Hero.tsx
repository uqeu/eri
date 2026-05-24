import Link from "next/link";

export function Hero(): React.ReactElement {
  return (
    <section className="bg-bg text-text">
      <div className="container pt-32 pb-20 lg:pt-44 lg:pb-28">
        <div className="max-w-3xl">
          <span className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-text-sec mb-8">
            <span className="inline-block h-1 w-1 rounded-full bg-demo-accent" aria-hidden />
            agentic · invite-only alpha
          </span>

          <h1
            className="text-h1 text-balance mb-6 leading-[1.02]"
            style={{ letterSpacing: "-0.03em", fontWeight: 500 }}
          >
            An agentic editor that learns how you think.
          </h1>

          <p className="text-text-sec text-[17px] leading-[1.55] max-w-prose mb-9">
            eri listens to your voice, watches where you point, and remembers
            how you build — then ships the diff under your gaze. It gets sharper
            every session you give it.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/download"
              className="inline-flex items-center rounded-md bg-text px-4 py-2 text-[14px] font-medium text-bg hover:opacity-90 transition-opacity"
            >
              Download for macOS
            </Link>
            <Link
              href="/contact"
              className="inline-flex items-center rounded-md border border-border px-4 py-2 text-[14px] text-text hover:bg-bg-card transition-colors"
            >
              Request alpha access
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
