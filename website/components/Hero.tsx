import Link from "next/link";

export function Hero(): React.ReactElement {
  return (
    <section className="bg-bg text-text">
      <div className="container pt-32 pb-20 lg:pt-44 lg:pb-28">
        <div className="max-w-3xl">

          <h1
            className="text-h1 text-balance mb-6 leading-[1.02]"
            style={{ letterSpacing: "-0.03em", fontWeight: 500 }}
          >
            Your computer, hands-free.
          </h1>

          <p className="text-text-sec text-[17px] leading-[1.55] max-w-prose mb-9">
            eri sees your screen, hears you, and remembers you — then does the
            work. Voice and eyes in, action out. A coding agent and a
            computer-use agent in one, learning how you work. Local-first by
            design.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/contact"
              className="inline-flex items-center rounded-md bg-text px-4 py-2 text-[14px] font-medium text-bg hover:opacity-90 transition-opacity"
            >
              Get early access
            </Link>
            <Link
              href="/docs"
              className="inline-flex items-center rounded-md border border-border px-4 py-2 text-[14px] text-text hover:bg-bg-card transition-colors"
            >
              See how it works
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
