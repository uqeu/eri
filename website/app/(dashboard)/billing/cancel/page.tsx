import Link from "next/link";

export default function BillingCancelPage() {
  return (
    <div className="max-w-2xl">
      <p className="text-xs uppercase tracking-[0.25em] text-accent">Billing</p>
      <h1 className="mt-3 font-display text-4xl md:text-5xl tracking-tight">
        Checkout canceled
      </h1>

      <section className="mt-12 border-t border-white/[0.06] pt-10">
        <p className="text-[14px] text-paper/80 leading-relaxed">
          No charge was made. You can keep using the free plan or come back
          and pick a different one any time.
        </p>

        <div className="mt-10 flex flex-col sm:flex-row gap-3 sm:items-center">
          <Link
            href="/pricing"
            className="btn-primary inline-flex items-center justify-center gap-1.5 px-4 py-2 text-[13px] rounded-md"
          >
            Back to pricing
            <span aria-hidden className="text-[10px]">
              →
            </span>
          </Link>
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-[13px] text-paper/80 hover:text-paper rounded-md border border-white/10 hover:border-white/20 transition"
          >
            Go to dashboard
          </Link>
        </div>
      </section>
    </div>
  );
}
