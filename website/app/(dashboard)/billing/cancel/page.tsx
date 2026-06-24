import Link from "next/link";

export default function BillingCancelPage() {
  return (
    <div className="max-w-2xl font-geist">
      <p className="font-geist-mono text-[11px] uppercase tracking-[0.18em] text-text-ter">
        Billing
      </p>
      <h1 className="mt-3 font-display text-[clamp(2rem,4vw,2.9rem)] font-600 leading-[1.04] tracking-[-0.03em] text-text">
        Checkout canceled
      </h1>

      <section className="mt-12 border-t border-border pt-10">
        <p className="text-[14px] leading-relaxed text-text-sec">
          No charge was made. You can keep using the free plan or come back
          and pick a different one any time.
        </p>

        <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Link
            href="/pricing"
            className="inline-flex items-center justify-center gap-1.5 rounded-full bg-[#16140f] px-4 py-2 text-[13.5px] font-600 text-white transition-transform duration-200 hover:-translate-y-px"
          >
            Back to pricing
            <span aria-hidden className="text-[10px]">
              →
            </span>
          </Link>
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center gap-1.5 rounded-full border border-border bg-bg-card px-4 py-2 text-[13.5px] text-text-sec transition-colors hover:border-[rgba(40,33,22,0.22)] hover:text-text"
          >
            Go to dashboard
          </Link>
        </div>
      </section>
    </div>
  );
}
