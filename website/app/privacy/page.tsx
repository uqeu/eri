import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterBig } from "@/components/FooterBig";

export const metadata: Metadata = {
  title: "Privacy — eri",
  description:
    "Plain-English privacy policy: voice is local, gaze is local, only eri Engine calls leave the device.",
};

interface Section {
  readonly heading: string;
  readonly body: string;
}

const SECTIONS: ReadonlyArray<Section> = [
  {
    heading: "1. The short version",
    body: "eri is a desktop app. Voice, gaze, and the editor itself run on your machine. The only data that leaves your device is the model call to the eri Engine and any third-party providers you've configured with your own keys. eri-cloud handles billing and account state — nothing else.",
  },
  {
    heading: "2. What we collect on the server",
    body: "Account email, a bcrypt hash of your password, subscription state from Stripe (tier, status, renewal date), and aggregated usage counters (iterations, deploys, voice minutes). We do not store prompts, code, voice recordings, or gaze data on our servers.",
  },
  {
    heading: "3. What stays on your machine",
    body: "Your microphone stream, the wakeword detector output, the gaze estimator output, every file in every open project, your shell history, and any local model weights. The eri runtime treats these as device-local by design — there is no code path that exfiltrates them.",
  },
  {
    heading: "4. Model calls",
    body: "When you trigger an edit, eri sends the relevant context to a model provider. By default this is the eri Engine. If you've configured Anthropic, OpenAI, Google, or a local Llama endpoint, calls go there instead. We sign the request on your behalf for billing tiers, but the request body still travels from your machine to the provider — we never see it.",
  },
  {
    heading: "5. Cookies & analytics",
    body: "The marketing site uses a single first-party cookie to remember your theme. We use PostHog for product analytics on the website — events only, no personally identifiable information. There is no advertising tracker on any eri property.",
  },
  {
    heading: "6. Sub-processors",
    body: "Stripe (billing), Resend (transactional email), Supabase EU (database and auth), Sentry (opt-out crash reports), PostHog (product analytics), Vercel (web hosting). Each has a data processing agreement on file. The current list lives on the security page and is updated when it changes.",
  },
  {
    heading: "7. Children",
    body: "eri is not intended for users under the age of 13. We do not knowingly collect data from children. If you believe we have, email privacy@eri.dev and we will delete the account.",
  },
  {
    heading: "8. International data transfers",
    body: "Account data is stored in Supabase's Frankfurt region. When you sign in from outside the EU, your session traverses our hosting provider's edge network. Standard Contractual Clauses apply for transfers out of the EEA.",
  },
  {
    heading: "9. Your rights",
    body: "You can export every piece of account data we hold by hitting the export endpoint in your dashboard. You can delete your account permanently from the same screen. If you'd rather email a human, write to privacy@eri.dev and we'll do it for you within 30 days.",
  },
  {
    heading: "10. Retention",
    body: "Active account data is kept while your account is active. Billing records are retained for seven years to comply with tax law. Usage counters are aggregated weekly and the raw events are discarded after 30 days. Deleted accounts are purged within 30 days of the request.",
  },
  {
    heading: "11. Security",
    body: "Passwords are bcrypt-hashed at cost factor 12. Session tokens are JWT HS256 with a 7-day expiry. All traffic uses TLS 1.3 with HSTS preloaded. BYOK API keys are encrypted at rest in your OS keychain — never on our servers.",
  },
  {
    heading: "12. Telemetry",
    body: "eri ships with crash reporting enabled by default through Sentry. You can turn it off in Settings → Privacy. Diagnostic events never include the contents of files, prompts, or voice frames — just stack traces and version metadata.",
  },
  {
    heading: "13. Changes to this policy",
    body: "If we make a material change, we will email every account holder at least 30 days before it takes effect. Cosmetic edits are made in place; the revision date below always reflects the latest version.",
  },
  {
    heading: "14. Contact",
    body: "Privacy questions go to privacy@eri.dev. Data deletion requests go to the same address. For everything else, see the contact page.",
  },
];

export default function PrivacyPage() {
  return (
    <main>
      <SiteHeader variant="solid" />

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-20 sm:py-28">
          <p className="text-xs uppercase tracking-[0.25em] text-accent">
            Privacy
          </p>
          <h1 className="mt-5 font-display text-4xl sm:text-6xl tracking-tight text-balance">
            Privacy policy.
          </h1>
          <p className="mt-5 text-lg text-muted leading-relaxed">
            Plain-English version of how eri handles data. The legal version is
            here too — we just refuse to bury the lede.
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
