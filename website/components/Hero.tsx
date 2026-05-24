import Link from "next/link";

export function Hero(): React.ReactElement {
  return (
    <section className="bg-bg text-text">
      <div className="container pt-28 pb-16 lg:pt-40 lg:pb-24">
        <div className="max-w-3xl">
          <div className="mb-6 inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-text-sec">
            <span className="inline-block h-1 w-1 rounded-full bg-demo-accent" aria-hidden />
            v0.4 · invite-only alpha
          </div>
          <h1
            className="text-h1 text-balance mb-6 leading-[1.02]"
            style={{ letterSpacing: "-0.03em", fontWeight: 500 }}
          >
            An editor that hears, sees, infers.
          </h1>
          <p className="text-text-sec text-[17px] leading-[1.55] max-w-prose mb-9">
            eri compiles your voice, your gaze, and the file you&apos;re actually
            in into one diffused edit. The model call is the only thing that
            crosses the wire.
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
              Request a demo
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
