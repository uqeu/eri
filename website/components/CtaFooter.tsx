import Link from "next/link";

export function CtaFooter(): React.ReactElement {
  return (
    <section className="relative overflow-hidden border-t border-white/[0.08]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 80% at 50% 0%, rgba(34,141,242,0.22) 0%, transparent 60%), radial-gradient(45% 70% at 80% 100%, rgba(224,255,79,0.18) 0%, transparent 65%), radial-gradient(50% 60% at 15% 100%, rgba(34,141,242,0.12) 0%, transparent 60%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-30 grain mix-blend-overlay"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/30 to-transparent"
      />

      <div className="relative mx-auto max-w-6xl px-6 py-32 sm:py-44">
        <div className="flex flex-col items-center text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-paper/65 backdrop-blur-sm">
            <span
              aria-hidden
              className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_10px_rgba(224,255,79,0.8)]"
            />
            v0.4 · macOS native · invite-only alpha
          </span>

          <h2 className="mt-8 font-display text-display font-normal leading-[0.95] text-balance">
            Build at the speed{" "}
            <span className="italic accent-shimmer">you think.</span>
          </h2>

          <p className="mt-6 max-w-2xl text-body leading-relaxed text-paper/65">
            Stop translating thought into keystrokes. eri anticipates the next
            change, resolves the diff under your gaze, and learns the way you
            build — session after session.
          </p>

          <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row">
            <Link
              href="/download"
              className="btn-primary group inline-flex items-center justify-center gap-2 px-6 py-3.5 text-[15px]"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden
              >
                <path
                  d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Download for macOS
              <span
                aria-hidden
                className="font-mono text-[11px] opacity-60 transition group-hover:opacity-100"
              >
                .dmg
              </span>
            </Link>
            <Link
              href="/docs"
              className="btn-ghost inline-flex items-center justify-center gap-2 px-6 py-3.5 text-[15px]"
            >
              Read the docs
              <span aria-hidden>→</span>
            </Link>
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 font-mono text-[11px] uppercase tracking-wider text-paper/45">
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden>↳</span>
              free during alpha
            </span>
            <span aria-hidden className="text-paper/20">
              ·
            </span>
            <span>bring your own keys</span>
            <span aria-hidden className="text-paper/20">
              ·
            </span>
            <span>cancel anytime, locally</span>
          </div>
        </div>

        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent"
        />
      </div>
    </section>
  );
}
