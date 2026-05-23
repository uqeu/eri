import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterBig } from "@/components/FooterBig";

export const metadata: Metadata = {
  title: "Contact — eri",
  description: "Get in touch with the eri team.",
};

interface Channel {
  readonly email: string;
  readonly purpose: string;
  readonly detail: string;
}

const CHANNELS: ReadonlyArray<Channel> = [
  {
    email: "phlotu@gmail.com",
    purpose: "Anything else",
    detail:
      "General questions, partnership ideas, feedback, hate mail. The operator reads this inbox.",
  },
  {
    email: "phlotu@gmail.com",
    purpose: "Product support",
    detail:
      "Bugs, account help, install issues. Include your eri build number and operating system if you can.",
  },
  {
    email: "phlotu@gmail.com",
    purpose: "Billing & refunds",
    detail:
      "Subscription, invoice, tax, refund. For card-level issues, Stripe support is faster than this inbox.",
  },
  {
    email: "phlotu@gmail.com",
    purpose: "Privacy & data requests",
    detail:
      "Access, deletion, correction, export. PIPEDA / GDPR / CCPA — same address, same person, same response time.",
  },
  {
    email: "phlotu@gmail.com",
    purpose: "Vulnerability reports",
    detail:
      "Responsible disclosure with safe harbour at /security/disclosure. PGP key on request.",
  },
  {
    email: "phlotu@gmail.com",
    purpose: "Abuse reports",
    detail:
      "Saw eri being misused? Saw something that violates the acceptable-use policy? Send it here.",
  },
  {
    email: "phlotu@gmail.com",
    purpose: "Legal & DMCA",
    detail:
      "Terms questions, IP notices, takedown requests, regulator inquiries.",
  },
  {
    email: "phlotu@gmail.com",
    purpose: "Press & media",
    detail:
      "Interview requests, brand assets, on-the-record commentary.",
  },
];

export default function ContactPage() {
  return (
    <main>
      <SiteHeader variant="solid" />

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-20 sm:py-28">
          <p className="text-xs uppercase tracking-[0.25em] text-accent">
            Contact
          </p>
          <h1 className="mt-5 font-display text-4xl sm:text-6xl tracking-tight text-balance">
            Email beats forms.
          </h1>
          <p className="mt-5 text-lg text-muted leading-relaxed">
            No contact form. Pick the inbox that matches what you need and the
            operator will write back. Most things land within a couple of
            business days.
          </p>
          <div className="mt-8">
            <a
              href="mailto:phlotu@gmail.com"
              className="btn-primary inline-flex items-center gap-2 px-5 py-2.5 text-sm"
            >
              phlotu@gmail.com <span aria-hidden>→</span>
            </a>
          </div>
        </div>
      </section>

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
          <h2 className="font-display text-3xl sm:text-4xl tracking-tight">
            Channels
          </h2>
          <ul className="mt-8 flex flex-col gap-3">
            {CHANNELS.map((channel) => (
              <li
                key={channel.email}
                className="rounded-lg border border-white/10 bg-white/[0.02] p-6"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <a
                    href={`mailto:${channel.email}`}
                    className="font-display text-xl tracking-tight text-paper hover:text-accent transition"
                  >
                    {channel.email}
                  </a>
                  <span className="font-mono text-[11px] uppercase tracking-wider text-paper/45">
                    {channel.purpose}
                  </span>
                </div>
                <p className="mt-3 text-muted leading-relaxed">
                  {channel.detail}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-3xl px-6 py-16">
          <h2 className="font-display text-3xl tracking-tight">
            Where the operator is
          </h2>
          <p className="mt-4 text-muted leading-relaxed">
            Ontario, Canada. There is no public mailing address — eri is an
            indie project, not an office. For anything that genuinely needs a
            postal address (legal service, certified mail), email{" "}
            <a
              href="mailto:phlotu@gmail.com"
              className="text-accent underline underline-offset-4"
            >
              phlotu@gmail.com
            </a>{" "}
            first and the operator will sort it out.
          </p>
        </div>
      </section>

      <FooterBig />
    </main>
  );
}
