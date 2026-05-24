import type { Metadata } from "next";
import Link from "next/link";
import { FooterBig } from "@/components/FooterBig";

export const metadata: Metadata = {
  title: "Billing — eri Help",
  description:
    "Plans, payments, refunds, taxes, and Stripe portal questions for eri.",
};

interface Article {
  readonly question: string;
  readonly answer: string;
}

const ARTICLES: ReadonlyArray<Article> = [
  {
    question: "How do I change my plan?",
    answer:
      "Dashboard → Billing → Change plan. Stripe handles the switch immediately; the proration appears on your next invoice. If you're going from a paid plan to free, the change applies at the end of the current billing period — you keep paid features until then.",
  },
  {
    question: "How do I cancel?",
    answer:
      "Dashboard → Billing → Manage billing → Cancel subscription. The cancellation takes effect at the end of the current billing period. There's no \"are you sure?\" gauntlet — one click cancels, and you can resubscribe any time.",
  },
  {
    question: "Can I get a refund?",
    answer:
      "Monthly plans: cancel any time and you stop being billed; the operator does not refund the current month after it has started. Annual plans: within 14 days of payment, email phlotu@gmail.com and the operator will refund the unused remainder. Past 14 days, the operator has discretion and will be reasonable. Usage-based overages are not refundable.",
  },
  {
    question: "Where are my invoices?",
    answer:
      "Dashboard → Billing → Manage billing opens the Stripe customer portal, where every invoice and receipt is downloadable as PDF. The same portal lets you update your card and your billing address.",
  },
  {
    question: "Do you charge tax?",
    answer:
      "Stripe applies tax based on your billing address and the operator's tax registrations. Canadian customers see GST/HST. EU/UK customers see VAT where the operator is registered. US sales tax is applied where required. Tax shows on the invoice, separately from the subscription line.",
  },
  {
    question: "My card was declined — what now?",
    answer:
      "Stripe will retry a few times. If it still fails, the operator emails the address on file with a link to update payment. The subscription stays active for a grace period; if payment isn't updated, the plan downgrades to free until it is. To fix it now: dashboard → Billing → Manage billing → Payment methods.",
  },
  {
    question: "Can I pay annually?",
    answer:
      "Some plans support annual billing at a discount — the option appears at checkout where it's offered. Switching from monthly to annual is a single action in the Stripe portal.",
  },
];

export default function HelpBillingPage() {
  return (
    <main>

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-20 sm:py-28">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em]">
            <Link
              href="/help"
              className="text-accent hover:text-paper transition"
            >
              Help
            </Link>
            <span aria-hidden className="text-paper/30">
              /
            </span>
            <span className="text-paper/55">Billing</span>
          </div>
          <h1 className="mt-5 font-display text-4xl sm:text-6xl tracking-tight text-balance">
            Billing &amp; plans.
          </h1>
          <p className="mt-5 text-lg text-muted leading-relaxed">
            Subscriptions run through Stripe. The customer portal handles
            invoices, card updates, taxes, and cancellation. For anything the
            portal can&apos;t do, phlotu@gmail.com.
          </p>
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
          <div className="flex flex-col gap-10">
            {ARTICLES.map((a) => (
              <div key={a.question}>
                <h2 className="font-display text-xl sm:text-2xl tracking-tight text-paper">
                  {a.question}
                </h2>
                <p className="mt-3 text-muted leading-relaxed">{a.answer}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <FooterBig />
    </main>
  );
}
