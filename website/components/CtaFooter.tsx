import Link from "next/link";

export function CtaFooter(): React.ReactElement {
  return (
    <section className="border-t border-border bg-bg">
      <div className="container py-28 lg:py-40">
        <div className="max-w-3xl">
          <h2 className="text-display font-normal leading-[0.95] text-balance text-text">
            Build at the speed{" "}
            <span className="italic" style={{ color: "var(--accent-clay)" }}>
              you think.
            </span>
          </h2>

          <p className="lead text-prose-narrow mt-8">
            Stop translating thought into keystrokes. eri anticipates the next
            change, resolves the diff under your gaze, and learns the way you
            build — session after session.
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-5">
            <Link
              href="/download"
              className="inline-flex items-center rounded-md bg-text px-4 py-2 text-[14px] font-medium text-bg hover:opacity-90 transition-opacity"
            >
              Download for macOS
              <span className="ml-2 font-mono text-[11px] opacity-60">.dmg</span>
            </Link>
            <Link
              href="/docs"
              className="inline-flex items-center text-[14px] text-text-sec hover:text-text transition-colors"
            >
              Read the docs
              <span className="ml-1.5">→</span>
            </Link>
          </div>

          <p className="mt-8 font-mono text-[11px] uppercase tracking-[0.18em] italic text-text-sec">
            v0.4 · invite-only alpha · BYOK · cancel locally
          </p>
        </div>
      </div>
    </section>
  );
}
