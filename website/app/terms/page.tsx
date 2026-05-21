import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterBig } from "@/components/FooterBig";

export const metadata: Metadata = {
  title: "Terms — eri",
  description:
    "Terms of use for eri. Independent project, provided as-is, Ontario law. Read this before you install.",
};

interface Section {
  readonly heading: string;
  readonly body: string;
}

const SECTIONS: ReadonlyArray<Section> = [
  {
    heading: "1. Read this first",
    body: "eri is an independent project — not a registered company. It's built and operated by a solo developer based in Ontario, Canada. There's no support desk, no SLA, no insurance policy behind it. By installing or signing in, you accept these terms and the fact that you're using an indie tool at your own risk. If that's a dealbreaker, don't use eri.",
  },
  {
    heading: "2. \"eri\", \"we\", \"you\"",
    body: "In these terms, \"eri\" and \"we\" mean the operator of the eri desktop application and the website at tryeri.ca. \"You\" means the person installing or using the software. There's no corporate entity yet — \"we\" is a writing convention, not a legal claim.",
  },
  {
    heading: "3. Your account",
    body: "An account is required to use any cloud-backed feature. You're responsible for keeping your credentials safe and for everything that happens under your account. One human per account. If you sign in via Google or another provider, you also agree to that provider's terms.",
  },
  {
    heading: "4. Acceptable use",
    body: "Don't use eri to do anything illegal where you live, anything that harms minors, anything that infringes someone's IP, anything that generates malware or evades sanctions, or anything that violates the acceptable-use policy of a model provider you've connected. We may suspend accounts that do. Full list lives at /legal/acceptable-use.",
  },
  {
    heading: "5. Your code is yours",
    body: "You keep every right to the code you write, dictate, generate, or modify with eri. We claim nothing. We do not train models on your prompts or your code. See the privacy policy for what we do collect (it's small).",
  },
  {
    heading: "6. Our software is licensed, not sold",
    body: "The eri client, the sidecar, the website, the brand, and the documentation are owned by the operator and licensed to you under these terms for your personal or internal business use. Don't redistribute the binary, don't decompile it (except where local law specifically permits), and don't use it to build a directly competing product.",
  },
  {
    heading: "7. Payment",
    body: "If you subscribe to a paid plan, billing runs through Stripe. Prices are shown in your local Stripe checkout. Taxes are added where required by Canadian or your local law. Subscriptions renew automatically until cancelled. Cancel any time from the dashboard.",
  },
  {
    heading: "8. Refunds",
    body: "Monthly plans: cancel any time; access continues until the end of the current period. Annual plans: within 14 days of payment, email billing@tryeri.ca for a prorated refund. Past 14 days, the operator has discretion and will be reasonable. Usage-based overages are not refundable.",
  },
  {
    heading: "9. Third-party model providers",
    body: "When you connect Anthropic, OpenAI, Google, or any other provider with your own keys, your relationship with that provider is governed entirely by their terms — not these. Their outages, content rules, pricing, and data practices apply directly between you and them.",
  },
  {
    heading: "10. No uptime promise",
    body: "eri is provided as-is. There is no uptime SLA. The desktop application continues to work on its own for local features when the cloud is offline. Don't depend on eri for production systems where downtime would hurt you.",
  },
  {
    heading: "11. Termination",
    body: "You may delete your account at any time from the dashboard. We may suspend or terminate accounts for violations of these terms, for non-payment, or where required by law. On termination, your subscription stops and your account data is purged within 30 days.",
  },
  {
    heading: "12. No warranty",
    body: "eri is provided \"AS IS\" and \"AS AVAILABLE\", without warranty of any kind, express or implied — including merchantability, fitness for a particular purpose, non-infringement, accuracy of AI-generated output, or uninterrupted operation. AI output can be wrong, biased, insecure, or misleading. Review every line before you ship it. You use eri at your sole risk.",
  },
  {
    heading: "13. Limitation of liability",
    body: "To the maximum extent permitted by law, the operator is not liable for any indirect, incidental, special, consequential, or punitive damages — including lost profits, lost data, business interruption, or damages caused by AI-generated output. Total aggregate liability for any direct claim is capped at the greater of CAD $100 or the amount you paid in the prior three months. Some jurisdictions don't allow certain limitations; in those, this clause applies to the maximum extent allowed.",
  },
  {
    heading: "14. Indemnification",
    body: "You agree to defend and hold the operator harmless from any claim, damage, or expense arising from your use of eri, your content, your violation of these terms, or your violation of someone else's rights.",
  },
  {
    heading: "15. Governing law and venue",
    body: "These terms are governed by the laws of the Province of Ontario and the federal laws of Canada that apply there, without regard to conflict-of-laws rules. Disputes that can't be resolved by writing each other a polite email go to the courts of Ontario, sitting in Toronto, and you and the operator both consent to that venue. Nothing here waives consumer-protection rights you have where you live.",
  },
  {
    heading: "16. Changes to these terms",
    body: "The operator may update these terms when the product, the law, or reality changes. Material changes get a 30-day heads-up by email to accounts with an active subscription. Cosmetic edits happen in place. The revision date below always reflects the current version.",
  },
  {
    heading: "17. Contact",
    body: "Questions about these terms go to legal@tryeri.ca. For anything else, see the contact page.",
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
            The agreement between you and the operator of eri. Plain-English.
            Indie project. Provided as-is. Section one is the TL;DR.
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
