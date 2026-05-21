import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { Footer } from "@/components/Footer";

export const metadata: Metadata = {
  title: "Security — eri",
  description:
    "Your code stays on your machine. Here's exactly what eri collects, what we don't, and how we protect what we do.",
};

interface Vendor {
  name: string;
  purpose: string;
  href: string;
}

const VENDORS: ReadonlyArray<Vendor> = [
  {
    name: "Stripe",
    purpose: "Subscription billing",
    href: "https://stripe.com/privacy-center/legal",
  },
  {
    name: "Resend",
    purpose: "Transactional email",
    href: "https://resend.com/legal/privacy-policy",
  },
  {
    name: "Supabase",
    purpose: "Postgres + auth (EU region)",
    href: "https://supabase.com/privacy",
  },
  {
    name: "Sentry",
    purpose: "Crash reporting (opt-out)",
    href: "https://sentry.io/trust/privacy/",
  },
  {
    name: "PostHog",
    purpose: "Product analytics (events, no PII)",
    href: "https://posthog.com/privacy",
  },
  {
    name: "Vercel",
    purpose: "Web hosting + deploy hooks",
    href: "https://vercel.com/legal/privacy-policy",
  },
];

const COLLECTED: ReadonlyArray<string> = [
  "Email address (for sign-in and billing receipts)",
  "Bcrypt-hashed password (cost factor 12 — we can never recover the original)",
  "Subscription state from Stripe (tier, status, renewal date)",
  "Usage counters (number of iterations, deploys — no content)",
  "Sentry crash reports (opt-out in settings)",
];

const NOT_COLLECTED: ReadonlyArray<string> = [
  "Your prompts or what you said out loud",
  "Your code — written, generated, or otherwise",
  "Your voice recordings (TTS is one-shot, never stored)",
  "Your gaze data (it never leaves your machine)",
  "Your API keys (BYOK keys are stored encrypted in your OS keychain)",
];

export default function SecurityPage() {
  return (
    <main>
      <SiteHeader variant="solid" />

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-20 sm:py-28">
          <p className="text-xs uppercase tracking-[0.25em] text-accent">
            Security
          </p>
          <h1 className="mt-5 font-display text-4xl sm:text-6xl tracking-tight text-balance">
            Your code stays on your machine.
          </h1>
          <p className="mt-5 text-lg text-muted leading-relaxed">
            eri is a desktop app. The model calls go from your machine straight
            to the provider (the eri Engine, Anthropic, OpenAI, or your local
            Llama). Our servers handle billing and account state — nothing
            else.
          </p>
        </div>
      </section>

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
          <h2 className="font-display text-3xl sm:text-4xl tracking-tight">
            How requests flow
          </h2>
          <div className="mt-8 rounded-lg border border-white/10 bg-white/[0.02] p-6 font-mono text-xs leading-relaxed text-paper/90">
            <pre>{`your machine ─────────────► eri Engine (diffusion)
              │
              ├──────────► Anthropic (Claude polish)
              │
              ├──────────► OpenAI / Gemini (if configured)
              │
              └──────────► eri-cloud (auth + billing only)
                              ↑
                              │ never receives:
                              │ - prompts
                              │ - code
                              │ - voice
                              │ - gaze`}</pre>
          </div>
          <p className="mt-6 text-muted leading-relaxed">
            On the Free plan, you provide your own keys and eri-cloud is
            essentially invisible. On Starter/Pro, we proxy billing-bound
            requests so we can count your usage, but the request body still
            goes provider-to-you — we sign the call without seeing it.
          </p>
        </div>
      </section>

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
          <h2 className="font-display text-3xl sm:text-4xl tracking-tight">
            Auth + encryption
          </h2>
          <ul className="mt-8 flex flex-col gap-3 text-paper/90 leading-relaxed">
            <li className="flex gap-3">
              <span className="text-accent" aria-hidden>—</span>
              <span>
                Passwords hashed with <strong>bcrypt</strong>, cost factor 12.
                We never see plaintext.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-accent" aria-hidden>—</span>
              <span>
                Session tokens are <strong>JWT HS256</strong>, 7-day expiry,
                rotated on sign-in.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-accent" aria-hidden>—</span>
              <span>
                All traffic encrypted in transit via <strong>TLS 1.3</strong>.
                HSTS preloaded on eri.dev.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-accent" aria-hidden>—</span>
              <span>
                BYOK API keys stored in your OS keychain (macOS Keychain,
                Windows Credential Manager, GNOME Keyring).
              </span>
            </li>
          </ul>
        </div>
      </section>

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
          <h2 className="font-display text-3xl sm:text-4xl tracking-tight">
            What we collect
          </h2>
          <ul className="mt-8 flex flex-col gap-2 text-paper/90">
            {COLLECTED.map((item) => (
              <li key={item} className="flex gap-3">
                <span className="text-accent" aria-hidden>✓</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>

          <h2 className="mt-16 font-display text-3xl sm:text-4xl tracking-tight">
            What we don&apos;t collect
          </h2>
          <ul className="mt-8 flex flex-col gap-2 text-paper/90">
            {NOT_COLLECTED.map((item) => (
              <li key={item} className="flex gap-3">
                <span className="text-muted" aria-hidden>✗</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
          <h2 className="font-display text-3xl sm:text-4xl tracking-tight">
            Vendors
          </h2>
          <p className="mt-4 text-muted leading-relaxed">
            These are the third parties eri-cloud talks to. Each one has a DPA
            on file. Click through for their compliance pages.
          </p>
          <ul className="mt-8 divide-y divide-white/10 border-y border-white/10">
            {VENDORS.map((vendor) => (
              <li
                key={vendor.name}
                className="py-4 flex items-center justify-between gap-6"
              >
                <div>
                  <div className="font-display text-lg">{vendor.name}</div>
                  <div className="text-sm text-muted">{vendor.purpose}</div>
                </div>
                <Link
                  href={vendor.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-paper hover:text-accent transition underline underline-offset-4 decoration-white/30"
                >
                  Privacy →
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
          <h2 className="font-display text-3xl sm:text-4xl tracking-tight">
            Compliance
          </h2>
          <p className="mt-4 text-muted leading-relaxed">
            We&apos;re a startup, so let&apos;s be honest about where we are.
          </p>
          <dl className="mt-8 grid gap-6 sm:grid-cols-2">
            <div className="rounded-lg border border-white/10 bg-white/[0.02] p-6">
              <dt className="font-display text-lg">SOC 2 Type II</dt>
              <dd className="mt-2 text-sm text-muted">
                In progress. Target: Q3 2026. We&apos;re working with Vanta on
                the audit window.
              </dd>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/[0.02] p-6">
              <dt className="font-display text-lg">GDPR</dt>
              <dd className="mt-2 text-sm text-muted">
                Data export and deletion endpoints live now. Email
                privacy@eri.dev or use the dashboard.
              </dd>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/[0.02] p-6">
              <dt className="font-display text-lg">HIPAA</dt>
              <dd className="mt-2 text-sm text-muted">
                Not supported. Don&apos;t put PHI through eri until we tell you
                otherwise.
              </dd>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/[0.02] p-6">
              <dt className="font-display text-lg">Data residency</dt>
              <dd className="mt-2 text-sm text-muted">
                Account data stored in Supabase EU (Frankfurt). Model providers
                handle their own regions.
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
          <h2 className="font-display text-3xl sm:text-4xl tracking-tight">
            Report a vulnerability
          </h2>
          <p className="mt-4 text-muted leading-relaxed">
            Found something? Email{" "}
            <a
              href="mailto:security@eri.dev"
              className="text-accent underline underline-offset-4"
            >
              security@eri.dev
            </a>{" "}
            with a description and reproduction steps. We respond within 48
            hours, fix critical issues within 7 days, and publicly credit
            researchers who want it.
          </p>
        </div>
      </section>

      <Footer />
    </main>
  );
}
