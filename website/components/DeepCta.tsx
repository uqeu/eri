import Link from "next/link";

// One clean dark band to close — premium and common in YC product sites. Solid
// near-black (not navy/gradient), sans headline, white primary CTA. Self-
// contained dark colours so it stays dark regardless of the paper theme.

export function DeepCta(): React.ReactElement {
  return (
    <section className="border-t border-border py-24 lg:py-32">
      <div className="container">
        <div
          className="relative overflow-hidden rounded-[20px] px-8 py-20 text-center sm:px-14 lg:py-28"
          style={{ background: "#111113" }}
        >
          <p className="mb-5 font-geist-mono text-[11px] uppercase tracking-[0.22em] text-white/45">
            Adaptive personal intelligence
          </p>
          <h2 className="mx-auto max-w-2xl font-geist text-[2.6rem] font-semibold leading-[1.04] tracking-[-0.035em] text-white lg:text-[3.6rem]">
            Live{" "}
            <span className="font-instrument italic font-normal">smarter.</span>
          </h2>
          <p className="mx-auto mt-5 max-w-md text-[16.5px] leading-relaxed text-white/55">
            The operating system for your life — local-first, private, and yours.
            In private alpha now.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/download"
              className="inline-flex items-center gap-2 rounded-md bg-white px-5 py-2.5 text-[14px] font-medium text-[#111113] transition-transform duration-200 ease-out hover:-translate-y-0.5 active:translate-y-0"
            >
              Request access
              <span aria-hidden>→</span>
            </Link>
            <Link
              href="/contact"
              className="inline-flex items-center rounded-md px-5 py-2.5 text-[14px] text-white/60 transition-colors duration-200 hover:text-white"
            >
              Talk to us
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
