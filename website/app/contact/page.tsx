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
    email: "hello@eri.dev",
    purpose: "Anything else",
    detail:
      "General questions, partnership ideas, hellos, hate mail. A real human reads this inbox.",
  },
  {
    email: "sales@eri.dev",
    purpose: "Teams & enterprise",
    detail:
      "Pricing for 10+ seats, procurement questions, custom data residency, security review requests.",
  },
  {
    email: "press@eri.dev",
    purpose: "Press & media",
    detail:
      "Interview requests, brand assets, embargoed briefings, on-the-record commentary.",
  },
  {
    email: "support@eri.dev",
    purpose: "Product support",
    detail:
      "Bug reports, account help, billing questions. Include your eri build number if you can.",
  },
  {
    email: "security@eri.dev",
    purpose: "Vulnerability reports",
    detail:
      "We respond within 48 hours and credit researchers who want it. PGP key on request.",
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
            We don't run a contact form. Pick the inbox that matches what you
            need and we'll write back.
          </p>
          <div className="mt-8">
            <a
              href="mailto:hello@eri.dev"
              className="btn-primary inline-flex items-center gap-2 px-5 py-2.5 text-sm"
            >
              hello@eri.dev <span aria-hidden>→</span>
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
            Mailing address
          </h2>
          <p className="mt-4 text-muted leading-relaxed">
            eri labs, inc.
            <br />
            548 Market St, PMB 41284
            <br />
            San Francisco, CA 94104
            <br />
            United States
          </p>
        </div>
      </section>

      <FooterBig />
    </main>
  );
}
