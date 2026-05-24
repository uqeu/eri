import type { Metadata } from "next";
import Link from "next/link";
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
    name: "Supabase",
    purpose: "Postgres + auth",
    href: "https://supabase.com/privacy",
  },
  {
    name: "Vercel",
    purpose: "Web hosting",
    href: "https://vercel.com/legal/privacy-policy",
  },
  {
    name: "Resend",
    purpose: "Transactional email",
    href: "https://resend.com/legal/privacy-policy",
  },
];

const COLLECTED: ReadonlyArray<string> = [
  "Email address (for sign-in and billing receipts)",
  "Salted password hash, or your OAuth identifier if you signed in with Google",
  "Subscription state from Stripe (plan, status, renewal date)",
  "Usage counters (aggregate, no content)",
  "Anonymous crash reports, if you leave telemetry on",
];

const NOT_COLLECTED: ReadonlyArray<string> = [
  "Your prompts or what you said out loud",
  "Your code — written, generated, or otherwise",
  "Your voice recordings (transcription is local; audio is never uploaded)",
  "Your gaze data (it never leaves your machine)",
  "Your API keys (BYOK keys are stored encrypted in your OS keychain)",
];

export default function SecurityPage() {
  return (
    <main>

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-20 sm:py-28">
          <p className="text-xs uppercase tracking-[0.25em] text-accent">
            Security
          </p>
          <h1 className="mt-5 font-display text-4xl sm:text-6xl tracking-tight text-balance">
            Your code stays on your machine.
          </h1>
          <p className="mt-5 text-lg text-muted leading-relaxed">
            eri is a desktop app. Model calls go from your machine to the
            provider (eri inference, Anthropic, OpenAI, or a local endpoint).
            The cloud side handles accounts and billing — that&apos;s it. This
            page is the honest version of how the pieces fit together.
          </p>
        </div>
      </section>

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
          <h2 className="font-display text-3xl sm:text-4xl tracking-tight">
            How requests flow
          </h2>
          <div className="mt-8 rounded-lg border border-white/10 bg-white/[0.02] p-6 font-mono text-xs leading-relaxed text-paper/90">
            <pre>{`your machine ─────────────► eri inference (default)
              │
              ├──────────► Anthropic / OpenAI / Google (BYOK)
              │
              ├──────────► local endpoint (Ollama, etc.)
              │
              └──────────► tryeri.ca (auth + billing only)
                              ↑
                              │ never receives:
                              │ - prompts
                              │ - code
                              │ - voice
                              │ - gaze`}</pre>
          </div>
          <p className="mt-6 text-muted leading-relaxed">
            With BYOK, the request goes from your machine to the provider you
            chose — the operator does not see the body. With the default eri
            inference proxy, requests are forwarded to the upstream model
            without retaining request or response bodies; only the metadata
            needed to count usage is recorded.
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
                Passwords stored as <strong>salted hashes</strong>. The
                plaintext is never written down. OAuth sign-in (Google) skips
                passwords entirely.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-accent" aria-hidden>—</span>
              <span>
                Sessions are signed tokens with a finite lifetime, rotated on
                sign-in.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-accent" aria-hidden>—</span>
              <span>
                All traffic uses <strong>TLS</strong> in transit. tryeri.ca
                serves over HTTPS only.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-accent" aria-hidden>—</span>
              <span>
                BYOK API keys live in your OS keychain (macOS Keychain,
                Windows Credential Manager, Secret Service on Linux). They are
                never sent to the operator&apos;s servers.
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
            The third parties the cloud side talks to. The full sub-processor
            list, including model providers and what data each one touches,
            lives at{" "}
            <Link
              href="/legal/sub-processors"
              className="text-paper underline underline-offset-4 decoration-white/30 transition hover:text-accent"
            >
              /legal/sub-processors
            </Link>
            .
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
            Compliance, honestly
          </h2>
          <p className="mt-4 text-muted leading-relaxed">
            eri is an indie project. The compliance posture page lives at{" "}
            <Link
              href="/trust"
              className="text-paper underline underline-offset-4 decoration-white/30 transition hover:text-accent"
            >
              /trust
            </Link>
            . The short version: GDPR / PIPEDA / CCPA-style requests are
            handled; SOC 2, ISO 27001, and HIPAA are not in place. If your
            review needs those today, eri is not the tool.
          </p>
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
              href="mailto:phlotu@gmail.com"
              className="text-accent underline underline-offset-4"
            >
              phlotu@gmail.com
            </a>{" "}
            with what you found and how to reproduce it. The full disclosure
            policy, including safe harbour, lives at{" "}
            <Link
              href="/security/disclosure"
              className="text-paper underline underline-offset-4 decoration-white/30 transition hover:text-accent"
            >
              /security/disclosure
            </Link>
            .
          </p>
        </div>
      </section>

      <Footer />
    </main>
  );
}
