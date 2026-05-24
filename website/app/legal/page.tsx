import type { Metadata } from "next";
import Link from "next/link";
import { FooterBig } from "@/components/FooterBig";

export const metadata: Metadata = {
  title: "Legal — eri",
  description:
    "All the legal documents for eri in one place. Terms, privacy, acceptable use, AI policy, sub-processors, and cookies.",
};

interface LegalDoc {
  readonly href: string;
  readonly title: string;
  readonly summary: string;
}

const DOCS: ReadonlyArray<LegalDoc> = [
  {
    href: "/terms",
    title: "Terms of use",
    summary:
      "The agreement between you and the operator of eri. Ontario law, indie project, provided as-is.",
  },
  {
    href: "/privacy",
    title: "Privacy policy",
    summary:
      "What data the operator collects (very little), where it lives, and how to delete it.",
  },
  {
    href: "/legal/acceptable-use",
    title: "Acceptable use policy",
    summary:
      "What you can't do with eri. Short list. Mostly: don't break the law, don't hurt people, don't bypass model-provider rules.",
  },
  {
    href: "/legal/ai-policy",
    title: "AI use policy",
    summary:
      "How AI outputs work in eri, training stance, and why you have to read the code before you ship it.",
  },
  {
    href: "/legal/sub-processors",
    title: "Sub-processors",
    summary:
      "The third parties the operator relies on to run eri — Stripe, Supabase, Vercel, model providers.",
  },
  {
    href: "/legal/cookies",
    title: "Cookie notice",
    summary:
      "What cookies the website sets, why, and how to turn off the optional ones.",
  },
  {
    href: "/legal/disclaimer",
    title: "Disclaimer",
    summary:
      "The standalone \"use at your own risk\" notice. The vibe of the whole project.",
  },
];

export default function LegalHubPage() {
  return (
    <main>

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-20 sm:py-28">
          <p className="text-xs uppercase tracking-[0.25em] text-accent">
            Legal
          </p>
          <h1 className="mt-5 font-display text-4xl sm:text-6xl tracking-tight text-balance">
            All the paperwork.
          </h1>
          <p className="mt-5 text-lg text-muted leading-relaxed">
            eri is an indie project run by one person in Ontario. These
            documents are the operator's best effort to be clear about what
            using eri means — what's yours, what's the operator's, and what
            isn't promised. Read the ones you care about.
          </p>
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
          <ul className="flex flex-col gap-3">
            {DOCS.map((doc) => (
              <li
                key={doc.href}
                className="rounded-lg border border-white/10 bg-white/[0.02] p-6 transition hover:border-white/20"
              >
                <Link href={doc.href} className="group block">
                  <div className="flex items-baseline justify-between gap-3">
                    <h2 className="font-display text-xl sm:text-2xl tracking-tight text-paper group-hover:text-accent transition">
                      {doc.title}
                    </h2>
                    <span
                      aria-hidden
                      className="text-paper/40 group-hover:text-accent transition"
                    >
                      →
                    </span>
                  </div>
                  <p className="mt-3 text-muted leading-relaxed">
                    {doc.summary}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <FooterBig />
    </main>
  );
}
