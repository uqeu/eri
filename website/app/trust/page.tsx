import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterBig } from "@/components/FooterBig";

export const metadata: Metadata = {
  title: "Trust — eri",
  description:
    "Security, compliance, and data residency at eri. SOC 2 in progress. GDPR-aware. Enterprise data residency.",
};

interface Posture {
  readonly status: "live" | "in-progress" | "available" | "not-yet";
  readonly title: string;
  readonly body: string;
}

const POSTURE: ReadonlyArray<Posture> = [
  {
    status: "live",
    title: "PIPEDA (Canada)",
    body: "eri is operated from Ontario and follows PIPEDA principles for the small amount of personal data the cloud side handles — consent on sign-up, access and deletion on request, breach notification where required.",
  },
  {
    status: "live",
    title: "GDPR / UK GDPR",
    body: "Access, rectification, deletion, and export are honoured for any account regardless of region. Standard Contractual Clauses cover transfers out of the EEA where sub-processors require them. Sub-processor list is at /legal/sub-processors.",
  },
  {
    status: "live",
    title: "CCPA / CPRA",
    body: "California residents can exercise the right to know, delete, correct, and opt out of any sale or sharing of personal information. The operator does not sell personal information — there is nothing to opt out of, but the channel is open at privacy@tryeri.ca.",
  },
  {
    status: "available",
    title: "Data residency",
    body: "Account data lives wherever the operator's database provider stores it (currently configurable per project). Model calls follow whichever provider you configure — that is a separate setting in the app.",
  },
  {
    status: "not-yet",
    title: "SOC 2 / ISO 27001",
    body: "eri is run by one person. Formal audits like SOC 2 Type II or ISO 27001 are not in place and are not on a committed timeline. If your security review needs them, eri is not the right tool for you today. Honest.",
  },
  {
    status: "not-yet",
    title: "HIPAA",
    body: "eri does not sign BAAs and is not designed for protected health information. Don't put PHI through eri.",
  },
];

const STATUS_STYLES: Record<Posture["status"], string> = {
  live: "border-[#41d57c]/40 bg-[#41d57c]/[0.08] text-[#9deec5]",
  "in-progress": "border-accent/40 bg-accent/[0.08] text-accent",
  available: "border-white/15 bg-white/[0.04] text-paper/75",
  "not-yet": "border-white/15 bg-white/[0.03] text-paper/55",
};

const STATUS_LABEL: Record<Posture["status"], string> = {
  live: "live",
  "in-progress": "in progress",
  available: "available",
  "not-yet": "not yet",
};

export default function TrustPage() {
  return (
    <main>
      <SiteHeader variant="solid" />

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-20 sm:py-28">
          <p className="text-xs uppercase tracking-[0.25em] text-accent">
            Trust
          </p>
          <h1 className="mt-5 font-display text-4xl sm:text-6xl tracking-tight text-balance">
            Trust, honestly.
          </h1>
          <p className="mt-5 text-lg text-muted leading-relaxed">
            eri is an independent project run from Ontario. There is no
            compliance theatre on this page — what is true is marked live,
            what is not, is marked not yet. If your procurement checklist
            requires SOC 2 today, save us both the time.
          </p>
        </div>
      </section>

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
          <h2 className="font-display text-3xl sm:text-4xl tracking-tight">
            Posture
          </h2>
          <ul className="mt-10 flex flex-col gap-4">
            {POSTURE.map((item) => (
              <li
                key={item.title}
                className="rounded-lg border border-white/10 bg-white/[0.02] p-6"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-display text-xl tracking-tight text-paper">
                    {item.title}
                  </h3>
                  <span
                    className={`inline-flex items-center rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider ${STATUS_STYLES[item.status]}`}
                  >
                    {STATUS_LABEL[item.status]}
                  </span>
                </div>
                <p className="mt-3 text-muted leading-relaxed">{item.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
          <h2 className="font-display text-3xl sm:text-4xl tracking-tight">
            Where data lives
          </h2>
          <p className="mt-6 text-paper/90 leading-relaxed">
            The eri desktop app keeps your project files, voice frames, gaze
            data, and shell history on the machine they originated on. The
            cloud side — accounts and billing — lives with the operator&apos;s
            database and hosting providers (see /legal/sub-processors for the
            current list and regions).
          </p>
          <p className="mt-5 text-muted leading-relaxed">
            Model calls follow whichever provider you connect. With BYOK, the
            request goes from your machine to that provider and the operator
            does not see it. With the default eri inference proxy, requests
            are forwarded without retaining request or response bodies.
          </p>
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
          <h2 className="font-display text-3xl sm:text-4xl tracking-tight">
            Asking the operator
          </h2>
          <p className="mt-4 text-muted leading-relaxed">
            There is no NDA package, no auditor letter, and no compliance
            portal. There is one inbox:{" "}
            <a
              href="mailto:trust@tryeri.ca"
              className="text-accent underline underline-offset-4"
            >
              trust@tryeri.ca
            </a>
            . The operator will answer your security questions honestly. The
            full architecture lives on the{" "}
            <Link
              href="/security"
              className="text-paper underline underline-offset-4 decoration-white/30 transition hover:text-accent"
            >
              security page
            </Link>
            , and the vulnerability disclosure policy is at{" "}
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

      <FooterBig />
    </main>
  );
}
