import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterBig } from "@/components/FooterBig";

export const metadata: Metadata = {
  title: "Help — eri",
  description:
    "Help center for eri. Getting started, account, billing, troubleshooting.",
};

interface Category {
  readonly href: string;
  readonly title: string;
  readonly summary: string;
  readonly topics: ReadonlyArray<string>;
}

const CATEGORIES: ReadonlyArray<Category> = [
  {
    href: "/help/getting-started",
    title: "Getting started",
    summary: "Install eri, sign in, and run your first edit.",
    topics: [
      "System requirements",
      "Installing on macOS / Windows / Linux",
      "Signing in (Google or email)",
      "Your first AI-assisted edit",
    ],
  },
  {
    href: "/help/account",
    title: "Account",
    summary: "Sign-in, OAuth, password, account deletion.",
    topics: [
      "Switching to Sign in with Google",
      "Resetting your password",
      "Deleting your account",
      "Data export",
    ],
  },
  {
    href: "/help/billing",
    title: "Billing & plans",
    summary: "Stripe, plans, refunds, taxes, receipts.",
    topics: [
      "Changing plans",
      "Cancelling a subscription",
      "Refunds",
      "Invoices and receipts",
    ],
  },
  {
    href: "/help/troubleshooting",
    title: "Troubleshooting",
    summary: "Common errors, install issues, model connection problems.",
    topics: [
      "Sign-in keeps failing",
      "Voice / microphone doesn't work",
      "Model returns no output",
      "Resetting the app",
    ],
  },
];

export default function HelpPage() {
  return (
    <main>
      <SiteHeader variant="solid" />

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-20 sm:py-28">
          <p className="text-xs uppercase tracking-[0.25em] text-accent">
            Help
          </p>
          <h1 className="mt-5 font-display text-4xl sm:text-6xl tracking-tight text-balance">
            How can we help?
          </h1>
          <p className="mt-5 text-lg text-muted leading-relaxed">
            Short articles for the questions that come up most. If you
            don&apos;t see what you need here, email{" "}
            <a
              href="mailto:phlotu@gmail.com"
              className="text-accent underline underline-offset-4"
            >
              phlotu@gmail.com
            </a>{" "}
            — a real person reads that inbox.
          </p>
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-5xl px-6 py-16 sm:py-24">
          <div className="grid gap-4 sm:grid-cols-2">
            {CATEGORIES.map((cat) => (
              <Link
                key={cat.href}
                href={cat.href}
                className="group flex h-full flex-col rounded-lg border border-white/10 bg-white/[0.02] p-6 transition hover:border-white/20"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="font-display text-xl tracking-tight text-paper group-hover:text-accent transition">
                    {cat.title}
                  </h2>
                  <span
                    aria-hidden
                    className="text-paper/40 group-hover:text-accent transition"
                  >
                    →
                  </span>
                </div>
                <p className="mt-3 text-muted leading-relaxed">{cat.summary}</p>
                <ul className="mt-5 flex flex-col gap-1.5">
                  {cat.topics.map((t) => (
                    <li
                      key={t}
                      className="font-mono text-[11px] uppercase tracking-wider text-paper/45"
                    >
                      · {t}
                    </li>
                  ))}
                </ul>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <FooterBig />
    </main>
  );
}
