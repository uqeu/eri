import type { Metadata } from "next";
import Link from "next/link";
import { FooterBig } from "@/components/FooterBig";

export const metadata: Metadata = {
  title: "Sub-processors — eri",
  description:
    "Third parties the operator uses to run eri. Stripe, Supabase, Vercel, Resend, model providers.",
};

interface Processor {
  readonly name: string;
  readonly purpose: string;
  readonly data: string;
  readonly region: string;
  readonly href: string;
}

const PROCESSORS: ReadonlyArray<Processor> = [
  {
    name: "Stripe",
    purpose: "Subscription billing and payment processing",
    data: "Name, email, billing address, payment instrument metadata, subscription state",
    region: "United States (with EU storage for European customers)",
    href: "https://stripe.com/privacy",
  },
  {
    name: "Supabase",
    purpose: "Authentication and Postgres database for account state",
    data: "Email, password hash (or OAuth identifier), account metadata, usage counters",
    region: "Per the project configuration — typically US or EU",
    href: "https://supabase.com/privacy",
  },
  {
    name: "Vercel",
    purpose: "Web hosting for tryeri.ca and dashboard",
    data: "HTTP request metadata (IP, user-agent, route), edge logs",
    region: "Global edge network",
    href: "https://vercel.com/legal/privacy-policy",
  },
  {
    name: "Resend (or equivalent)",
    purpose: "Transactional email — sign-in, billing receipts, account events",
    data: "Email address, message metadata",
    region: "United States",
    href: "https://resend.com/legal/privacy-policy",
  },
  {
    name: "Google",
    purpose: "OAuth sign-in (only if you choose Sign in with Google)",
    data: "OAuth identifier, email, name as provided by Google",
    region: "Global",
    href: "https://policies.google.com/privacy",
  },
];

interface ModelProvider {
  readonly name: string;
  readonly purpose: string;
  readonly href: string;
}

const MODEL_PROVIDERS: ReadonlyArray<ModelProvider> = [
  {
    name: "eri inference (Mercury 2 wrap)",
    purpose: "Default code generation via diffusion model — forwarded without retention",
    href: "https://www.inceptionlabs.ai/",
  },
  {
    name: "Anthropic (Claude)",
    purpose: "Optional BYOK or proxied — used when you connect Anthropic",
    href: "https://www.anthropic.com/legal/privacy",
  },
  {
    name: "OpenAI",
    purpose: "Optional BYOK — used when you connect an OpenAI key",
    href: "https://openai.com/policies/privacy-policy",
  },
  {
    name: "Google AI",
    purpose: "Optional BYOK — used when you connect a Google AI key",
    href: "https://policies.google.com/privacy",
  },
];

export default function SubProcessorsPage() {
  return (
    <main>

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-20 sm:py-28">
          <p className="text-xs uppercase tracking-[0.25em] text-accent">
            Legal · Sub-processors
          </p>
          <h1 className="mt-5 font-display text-4xl sm:text-6xl tracking-tight text-balance">
            Who else is in the loop.
          </h1>
          <p className="mt-5 text-lg text-muted leading-relaxed">
            eri is a small operation, but it sits on a handful of third
            parties to do things the operator shouldn&apos;t be reinventing —
            payments, email, hosting, auth. Here&apos;s every sub-processor
            currently in use, what data they touch, and where they store it.
          </p>
          <p className="mt-6 font-mono text-[11px] uppercase tracking-wider text-paper/40">
            Last updated · May 21, 2026
          </p>
        </div>
      </section>

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
          <h2 className="font-display text-3xl sm:text-4xl tracking-tight">
            Infrastructure sub-processors
          </h2>
          <ul className="mt-8 flex flex-col gap-3">
            {PROCESSORS.map((p) => (
              <li
                key={p.name}
                className="rounded-lg border border-white/10 bg-white/[0.02] p-6"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <h3 className="font-display text-xl tracking-tight text-paper">
                    {p.name}
                  </h3>
                  <Link
                    href={p.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-paper hover:text-accent transition underline underline-offset-4 decoration-white/30"
                  >
                    Privacy →
                  </Link>
                </div>
                <dl className="mt-4 grid gap-3 text-sm text-muted leading-relaxed sm:grid-cols-[100px_1fr]">
                  <dt className="font-mono text-[11px] uppercase tracking-wider text-paper/45">
                    Purpose
                  </dt>
                  <dd className="text-paper/85">{p.purpose}</dd>
                  <dt className="font-mono text-[11px] uppercase tracking-wider text-paper/45">
                    Data
                  </dt>
                  <dd className="text-paper/85">{p.data}</dd>
                  <dt className="font-mono text-[11px] uppercase tracking-wider text-paper/45">
                    Region
                  </dt>
                  <dd className="text-paper/85">{p.region}</dd>
                </dl>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
          <h2 className="font-display text-3xl sm:text-4xl tracking-tight">
            Model providers
          </h2>
          <p className="mt-4 text-muted leading-relaxed">
            Model providers are listed separately because they only see data
            when you actually trigger a model call, and only in the
            configuration you chose. Calls go from your machine to the
            provider; the operator does not retain request or response bodies.
          </p>
          <ul className="mt-8 flex flex-col gap-3">
            {MODEL_PROVIDERS.map((m) => (
              <li
                key={m.name}
                className="rounded-lg border border-white/10 bg-white/[0.02] p-6"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <h3 className="font-display text-lg tracking-tight text-paper">
                    {m.name}
                  </h3>
                  <Link
                    href={m.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-paper hover:text-accent transition underline underline-offset-4 decoration-white/30"
                  >
                    Privacy →
                  </Link>
                </div>
                <p className="mt-3 text-sm text-muted leading-relaxed">
                  {m.purpose}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
          <h2 className="font-display text-3xl sm:text-4xl tracking-tight">
            When this list changes
          </h2>
          <p className="mt-4 text-muted leading-relaxed">
            If the operator adds or replaces a sub-processor, this page is
            updated and the revision date above moves. For material changes —
            new categories of data, new regions — accounts with an active
            subscription get an email at least 30 days before the change takes
            effect. Questions go to{" "}
            <a
              href="mailto:phlotu@gmail.com"
              className="text-accent underline underline-offset-4"
            >
              phlotu@gmail.com
            </a>
            .
          </p>
        </div>
      </section>

      <FooterBig />
    </main>
  );
}
