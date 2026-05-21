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
  readonly status: "live" | "in-progress" | "available";
  readonly title: string;
  readonly body: string;
}

const POSTURE: ReadonlyArray<Posture> = [
  {
    status: "in-progress",
    title: "SOC 2 Type II",
    body: "We're mid-audit with Vanta. Target attestation window closes Q3 2026. We can share the latest auditor letter under NDA today.",
  },
  {
    status: "live",
    title: "GDPR",
    body: "Account data lives in Supabase's Frankfurt region. Export and deletion endpoints are live in the dashboard. Standard Contractual Clauses cover transfers out of the EEA.",
  },
  {
    status: "live",
    title: "CCPA",
    body: "California residents can exercise the right to know, delete, and opt out of any sale of personal information. We don't sell personal information — there's nothing to opt out of, but the channel is open.",
  },
  {
    status: "available",
    title: "Data residency",
    body: "Enterprise accounts can pin account data to EU, US-East, or US-West regions. Model calls follow the provider you configure — that's a separate setting.",
  },
  {
    status: "in-progress",
    title: "ISO 27001",
    body: "On the roadmap once SOC 2 lands. We'll share a target date publicly when the gap analysis finishes.",
  },
  {
    status: "live",
    title: "Penetration testing",
    body: "Annual third-party pentest. Latest report available under NDA. Remediation timelines tracked publicly in the security changelog.",
  },
];

const STATUS_STYLES: Record<Posture["status"], string> = {
  live: "border-[#41d57c]/40 bg-[#41d57c]/[0.08] text-[#9deec5]",
  "in-progress": "border-accent/40 bg-accent/[0.08] text-accent",
  available: "border-white/15 bg-white/[0.04] text-paper/75",
};

const STATUS_LABEL: Record<Posture["status"], string> = {
  live: "live",
  "in-progress": "in progress",
  available: "available",
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
            Boring promises, kept on schedule.
          </h1>
          <p className="mt-5 text-lg text-muted leading-relaxed">
            Security and compliance posture for eri labs. We try to over-share
            here so your security review is short.
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
            eri-cloud control plane runs in Supabase's Frankfurt region by
            default. Enterprise customers can pin to US-East or US-West with
            one config change.
          </p>
          <p className="mt-5 text-muted leading-relaxed">
            Model calls follow whatever provider you've configured. The eri
            Engine runs in US-East with EU mirroring on the roadmap. BYOK
            providers are between you and them.
          </p>
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
          <h2 className="font-display text-3xl sm:text-4xl tracking-tight">
            Get the documents
          </h2>
          <p className="mt-4 text-muted leading-relaxed">
            We share our latest SOC 2 letter, pentest report, sub-processor
            list, and DPA under NDA. Email{" "}
            <a
              href="mailto:trust@eri.dev"
              className="text-accent underline underline-offset-4"
            >
              trust@eri.dev
            </a>{" "}
            and we'll send a package the same business day. The full security
            architecture lives on the{" "}
            <Link
              href="/security"
              className="text-paper underline underline-offset-4 decoration-white/30 transition hover:text-accent"
            >
              security page
            </Link>
            .
          </p>
        </div>
      </section>

      <FooterBig />
    </main>
  );
}
