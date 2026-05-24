import type { Metadata } from "next";
import Link from "next/link";
import { FooterBig } from "@/components/FooterBig";

export const metadata: Metadata = {
  title: "Careers — eri",
  description:
    "eri is an independent project run by one person. Not hiring full-time roles right now. Email if you'd like to contribute.",
};

export default function CareersPage() {
  return (
    <main>

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-20 sm:py-28">
          <p className="text-xs uppercase tracking-[0.25em] text-accent">
            Careers
          </p>
          <h1 className="mt-5 font-display text-4xl sm:text-6xl tracking-tight text-balance">
            Honestly? No openings.
          </h1>
          <p className="mt-5 text-lg text-muted leading-relaxed">
            eri is an independent project — one person, based in Ontario.
            There is no team to join, no equity to offer, and no salary to
            quote. If that changes, this page is where the first listings
            will go.
          </p>
        </div>
      </section>

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
          <h2 className="font-display text-3xl sm:text-4xl tracking-tight">
            Want to contribute anyway?
          </h2>
          <p className="mt-4 text-muted leading-relaxed">
            Plenty of useful things to do that aren&apos;t full-time roles —
            bug reports, design feedback, docs improvements, prompt-tuning
            experiments, open-source patches on the parts that live in
            public. If you&apos;d like to help, email{" "}
            <a
              href="mailto:phlotu@gmail.com"
              className="text-accent underline underline-offset-4"
            >
              phlotu@gmail.com
            </a>{" "}
            with one paragraph about what you&apos;d work on.
          </p>
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
          <h2 className="font-display text-3xl sm:text-4xl tracking-tight">
            If you wanted to apply
          </h2>
          <p className="mt-4 text-muted leading-relaxed">
            The product itself is the application. Use it. Send feedback.
            Show your work. The day eri becomes a place that hires, the
            people who already shaped it are the ones the operator wants to
            hear from first. In the meantime, the{" "}
            <Link
              href="/blog"
              className="text-paper underline underline-offset-4 decoration-white/30 transition hover:text-accent"
            >
              blog
            </Link>{" "}
            is where build-in-public updates land.
          </p>
        </div>
      </section>

      <FooterBig />
    </main>
  );
}
