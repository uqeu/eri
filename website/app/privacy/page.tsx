import type { Metadata } from "next";
import { FooterBig } from "@/components/FooterBig";

export const metadata: Metadata = {
  title: "Privacy — eri",
  description:
    "Plain-English privacy policy: voice is local, gaze is local, only eri's engine calls leave the device.",
};

interface Section {
  readonly heading: string;
  readonly body: string;
}

const SECTIONS: ReadonlyArray<Section> = [
  {
    heading: "1. The short version",
    body: "eri is a desktop app. Voice, gaze, and the editor run on your machine. Account state and billing run in the cloud — that's it. The operator does not train models on your prompts, your code, or your voice. This policy explains, in plain English, what data the operator collects, where it lives, and how to make it go away.",
  },
  {
    heading: "2. Who is collecting your data",
    body: "eri is an independent project operated by a solo developer in Ontario, Canada. There is no corporate entity. \"The operator\" in this policy means that person. Contact: phlotu@gmail.com.",
  },
  {
    heading: "3. What the cloud side collects",
    body: "When you create an account, the operator stores: your email; a salted hash of your password (or the OAuth identifier if you signed in with Google); your subscription state from Stripe (plan, status, renewal date); and aggregated usage counters used to enforce plan limits. That's the full list. Prompts, code, voice recordings, and gaze data are never sent to the cloud.",
  },
  {
    heading: "4. What stays on your machine",
    body: "Microphone audio, the wakeword detector output, the gaze estimator output, every file in every open project, your shell history, and any local model weights all stay on your device. The eri client is designed so there is no code path that uploads them.",
  },
  {
    heading: "5. Model calls",
    body: "When you trigger an edit, eri sends the relevant code context to a model provider. By default this is the eri inference proxy (a paid wrap of a diffusion code model). If you've configured Anthropic, OpenAI, Google, or a local endpoint with your own key (BYOK), the call goes there instead and the operator does not see the request body. For the proxied case, requests are forwarded without logging request or response bodies.",
  },
  {
    heading: "6. Cookies & analytics",
    body: "The website uses essential first-party cookies for sign-in sessions and remembering your theme. There may be lightweight product analytics on the website (anonymous event counts — no PII, no advertising trackers). Full breakdown lives at /legal/cookies.",
  },
  {
    heading: "7. Sub-processors",
    body: "The operator uses a small set of third parties to run eri: Stripe (billing), Supabase (database + auth), Vercel (web hosting), Resend or a similar provider (transactional email), and your chosen model provider. The full current list lives at /legal/sub-processors and is updated when it changes.",
  },
  {
    heading: "8. Your rights",
    body: "If you're in Canada, the EU/UK, California, or anywhere with comparable laws, you have the right to access, correct, delete, and export the personal data the operator holds about you. Use the dashboard to delete your account, or email phlotu@gmail.com. The operator will respond within 30 days. PIPEDA, GDPR, UK GDPR, and CCPA-style requests all route to the same address.",
  },
  {
    heading: "9. International transfers",
    body: "Sub-processors may store data in Canada, the United States, or the EU depending on the provider. Where transfers are subject to GDPR/UK GDPR, Standard Contractual Clauses are relied on. If you'd rather not have your data leave a specific region, eri may not be the right tool right now.",
  },
  {
    heading: "10. Retention",
    body: "Account data is kept while your account is active. After you delete an account, the operator removes the account record and associated data within 30 days, except for billing records that tax law requires to be kept longer (in Canada, six years).",
  },
  {
    heading: "11. Security",
    body: "Passwords are stored as salted hashes — the plaintext is never persisted. All traffic uses TLS. BYOK API keys are stored encrypted in your OS keychain (macOS Keychain, Windows Credential Manager, Secret Service on Linux) and never sent to the operator's servers. The operator is one person and does not claim a SOC 2 audit, ISO certification, or anything similar. Treat eri's cloud side as the security profile of a well-run indie project, not an enterprise vendor.",
  },
  {
    heading: "12. Telemetry & crash reports",
    body: "If crash reporting is enabled, eri may send anonymous stack traces and version metadata to help the operator fix bugs. Crash reports never include file contents, prompts, audio, or keys. You can disable telemetry in Settings → Privacy.",
  },
  {
    heading: "13. Training",
    body: "The operator does not train models on your prompts, code, or any data you put into eri. The model providers you connect have their own training policies — check their privacy pages. The eri inference proxy passes data through without retaining it for training.",
  },
  {
    heading: "14. Children",
    body: "eri is not intended for users under 13 (or under 16 in jurisdictions with a higher age of digital consent). The operator does not knowingly collect data from children. If you believe a child has signed up, email phlotu@gmail.com and the account will be removed.",
  },
  {
    heading: "15. Automated decision-making",
    body: "The operator does not make decisions about you that produce legal or similarly significant effects based solely on automated processing. Model output is a tool to help you write code; we do not use it to grant or deny access, set pricing tiers, or evaluate you in any way that has a meaningful real-world impact.",
  },
  {
    heading: "16. Breach notification",
    body: "If the operator discovers a security incident that compromises personal data, affected accounts will be notified by email without undue delay and, where applicable laws require it, within 72 hours of discovery. The notice will explain what happened, what data was involved, what's been done about it, and steps you can take. The operator also notifies the Office of the Privacy Commissioner of Canada when required under PIPEDA.",
  },
  {
    heading: "17. Data minimization",
    body: "The operator collects only what's needed to run eri. There are no behavioural advertising profiles, no third-party advertising cookies, no data brokers, no cross-site tracking, and no \"shadow\" telemetry that records what you type or build. If a feature can ship without collecting data, that's how it ships.",
  },
  {
    heading: "18. Do Not Track and Global Privacy Control",
    body: "The website honours the Global Privacy Control signal where applicable: receiving GPC is treated as a deletion-of-cookies and opt-out-of-analytics request for that browser. Do Not Track headers are also respected as a signal even though the standard is informal.",
  },
  {
    heading: "19. Changes to this policy",
    body: "If the operator makes a material change, accounts with an active subscription get an email at least 30 days before the change takes effect. Cosmetic edits are made in place. The revision date below always reflects the current version. Continued use after the effective date counts as acceptance.",
  },
  {
    heading: "20. Contact",
    body: "Privacy questions, access requests, and deletion requests all go to phlotu@gmail.com. For everything else, see /contact.",
  },
];

export default function PrivacyPage() {
  return (
    <main>

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-20 sm:py-28">
          <p className="text-xs uppercase tracking-[0.25em] text-accent">
            Privacy
          </p>
          <h1 className="mt-5 font-display text-4xl sm:text-6xl tracking-tight text-balance">
            Privacy policy.
          </h1>
          <p className="mt-5 text-lg text-muted leading-relaxed">
            Plain-English version of how eri handles your data. The operator is
            one person, in Ontario. There's not much to collect, and what
            there is doesn't get trained on.
          </p>
          <p className="mt-6 font-mono text-[11px] uppercase tracking-wider text-paper/40">
            Last updated · May 23, 2026
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
