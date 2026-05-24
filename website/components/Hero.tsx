import Link from "next/link";

export function Hero(): React.ReactElement {
  return (
    <section className="bg-bg text-text">
      <div className="container pt-24 pb-12 lg:pt-36 lg:pb-20">
        <div className="max-w-3xl">
          <h1 className="text-h1 text-balance mb-6 leading-[1.04]">
            An editor that hears, sees, infers.
          </h1>
          <p className="lead text-prose-narrow mb-8">
            eri compiles your voice, your gaze, and the file you&apos;re actually in into one diffused edit. The model call is the only thing that crosses the wire.
          </p>
          <div className="flex flex-wrap items-center gap-5">
            <Link
              href="/download"
              className="inline-flex items-center rounded-md bg-text px-4 py-2 text-[14px] font-medium text-bg hover:opacity-90 transition-opacity"
            >
              Download for macOS
              <span className="ml-2">⤓</span>
            </Link>
            <Link
              href="/contact"
              className="inline-flex items-center text-[14px] text-text-sec hover:text-text transition-colors"
            >
              Request a demo
              <span className="ml-1.5">→</span>
            </Link>
          </div>
          <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.18em] italic text-text-sec">
            Pre-launch · free in beta · no card
          </p>
        </div>
      </div>
    </section>
  );
}
