import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterBig } from "@/components/FooterBig";

export const metadata: Metadata = {
  title: "Terms — eri",
  description:
    "Terms of service for using eri. Account, acceptable use, payment, tier limits, termination.",
};

interface Section {
  readonly heading: string;
  readonly body: string;
}

const SECTIONS: ReadonlyArray<Section> = [
  {
    heading: "1. Who we are",
    body: "These terms govern your use of eri, a desktop application and associated cloud services operated by eri labs, inc., a Delaware corporation headquartered in San Francisco. \"We\", \"us\", and \"eri\" refer to that company. \"You\" refers to the person or legal entity using the product.",
  },
  {
    heading: "2. Your account",
    body: "You need an account to use eri above the free local-only tier. You are responsible for safeguarding your credentials. One human per account — sharing logins is not allowed. If you create an account on behalf of an organization, you represent that you have authority to bind it to these terms.",
  },
  {
    heading: "3. Acceptable use",
    body: "Don't use eri to build, deploy, or operate software that is illegal, harms minors, infringes copyright, generates malware, evades sanctions, or violates the acceptable use policy of any model provider you've configured. We reserve the right to suspend accounts that do.",
  },
  {
    heading: "4. Your code is yours",
    body: "You retain all rights to the code you write, dictate, generate, or modify in eri. We claim no ownership over your output. We don't train models on your prompts or code under any tier, ever — see the privacy policy for the longer story.",
  },
  {
    heading: "5. Our software is ours",
    body: "The eri client, the eri Engine, the marketing site, our brand, and the documentation are owned by eri labs and licensed to you under these terms. You may not redistribute the binary, decompile it (except where local law specifically permits), or use it to build a directly competing product.",
  },
  {
    heading: "6. Payment",
    body: "Paid tiers are billed monthly or annually in advance through Stripe. Prices are listed in US dollars unless your local Stripe checkout shows otherwise. Taxes are added where required. Annual plans renew automatically unless cancelled at least 24 hours before the renewal date.",
  },
  {
    heading: "7. Tier limits & overages",
    body: "Each paid tier includes a monthly allowance of iterations, deploys, and voice minutes. If you exceed the allowance, additional usage is metered at the rate shown on the pricing page. We notify you at 80% of the allowance and again at 100%. We will never silently auto-upgrade you to a higher tier.",
  },
  {
    heading: "8. Refunds",
    body: "Cancel at any time. For monthly plans, your access continues until the end of the current billing period. For annual plans, contact billing@eri.dev within 14 days of payment for a full refund of the unused remainder, prorated against monthly value. Overages are not refundable.",
  },
  {
    heading: "9. Third-party model providers",
    body: "When you bring your own keys for Anthropic, OpenAI, Google, or another provider, your relationship with that provider is governed by their terms — not ours. Their outages, content policies, and pricing apply directly between you and them. We pass calls through without modification.",
  },
  {
    heading: "10. Service availability",
    body: "We don't promise a specific uptime number outside enterprise contracts. We do publish a status page and we credit Enterprise tier customers per their signed agreement when we miss the targets in it. The desktop app continues to function during eri-cloud outages on tiers that allow local-only fallback.",
  },
  {
    heading: "11. Termination",
    body: "You may delete your account at any time from the dashboard. We may suspend or terminate accounts for violations of these terms, for non-payment after 14 days of notice, or as required by law. On termination, your subscription stops and your account data is purged within 30 days.",
  },
  {
    heading: "12. Warranty disclaimer",
    body: "eri is provided \"as is\". We don't warrant that the software is bug-free, that the model output is correct, or that the product fits your specific use case. AI-generated code in particular should be reviewed before it ships to anything that matters.",
  },
  {
    heading: "13. Limitation of liability",
    body: "To the maximum extent permitted by law, our total liability for any claim arising out of these terms is capped at the greater of one hundred US dollars or the amount you paid us in the twelve months preceding the claim. We are not liable for indirect, incidental, or consequential damages.",
  },
  {
    heading: "14. Governing law",
    body: "These terms are governed by the laws of the State of California, without regard to its conflict of laws principles. Disputes go to the state or federal courts in San Francisco County, and you and we both consent to that jurisdiction.",
  },
  {
    heading: "15. Changes to these terms",
    body: "We may update these terms when the product or the law changes. If a change is material, we will notify you at least 30 days in advance by email. Continuing to use eri after the effective date means you accept the new terms. The revision date below always reflects the current version.",
  },
];

export default function TermsPage() {
  return (
    <main>
      <SiteHeader variant="solid" />

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-20 sm:py-28">
          <p className="text-xs uppercase tracking-[0.25em] text-accent">
            Terms
          </p>
          <h1 className="mt-5 font-display text-4xl sm:text-6xl tracking-tight text-balance">
            Terms of service.
          </h1>
          <p className="mt-5 text-lg text-muted leading-relaxed">
            The legal agreement between you and eri labs, inc. We've tried to
            keep it readable. The TL;DR is at section one.
          </p>
          <p className="mt-6 font-mono text-[11px] uppercase tracking-wider text-paper/40">
            Last updated · May 21, 2026
          </p>
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
          <div className="flex flex-col gap-10">
            {SECTIONS.map((section) => (
              <div key={section.heading}>
                <h2 className="font-display text-xl sm:text-2xl tracking-tight text-paper">
                  {section.heading}
                </h2>
                <p className="mt-3 text-muted leading-relaxed">
                  {section.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <FooterBig />
    </main>
  );
}
