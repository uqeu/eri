import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterBig } from "@/components/FooterBig";

export const metadata: Metadata = {
  title: "Status — eri",
  description:
    "Current operational status of the eri cloud and known incidents.",
};

interface Component {
  readonly name: string;
  readonly status: "operational" | "degraded" | "outage" | "unknown";
  readonly note: string;
}

const COMPONENTS: ReadonlyArray<Component> = [
  {
    name: "Website (tryeri.ca)",
    status: "operational",
    note: "Marketing site and dashboard.",
  },
  {
    name: "Authentication",
    status: "operational",
    note: "Sign-in, OAuth, account session.",
  },
  {
    name: "Billing",
    status: "operational",
    note: "Stripe checkout and subscription state.",
  },
  {
    name: "eri inference proxy",
    status: "operational",
    note: "Default model forwarding for paid plans.",
  },
];

const STYLE_BY_STATUS: Record<Component["status"], string> = {
  operational: "border-[#41d57c]/40 bg-[#41d57c]/[0.08] text-[#9deec5]",
  degraded: "border-accent/40 bg-accent/[0.08] text-accent",
  outage: "border-red-400/40 bg-red-400/[0.08] text-red-300",
  unknown: "border-white/15 bg-white/[0.04] text-paper/55",
};

const LABEL_BY_STATUS: Record<Component["status"], string> = {
  operational: "operational",
  degraded: "degraded",
  outage: "outage",
  unknown: "unknown",
};

export default function StatusPage() {
  const allGreen = COMPONENTS.every((c) => c.status === "operational");

  return (
    <main>
      <SiteHeader variant="solid" />

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-20 sm:py-28">
          <p className="text-xs uppercase tracking-[0.25em] text-accent">
            Status
          </p>
          <h1 className="mt-5 font-display text-4xl sm:text-6xl tracking-tight text-balance">
            {allGreen ? "All systems operational." : "Some components affected."}
          </h1>
          <p className="mt-5 text-lg text-muted leading-relaxed">
            This page is updated by the operator when incidents happen. It is
            not yet an automated monitoring page — if eri feels broken and
            this page is still green, treat that as a signal to email{" "}
            <a
              href="mailto:support@tryeri.ca"
              className="text-accent underline underline-offset-4"
            >
              support@tryeri.ca
            </a>
            .
          </p>
        </div>
      </section>

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
          <h2 className="font-display text-3xl sm:text-4xl tracking-tight">
            Components
          </h2>
          <ul className="mt-8 flex flex-col gap-3">
            {COMPONENTS.map((c) => (
              <li
                key={c.name}
                className="rounded-lg border border-white/10 bg-white/[0.02] p-6"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-display text-lg tracking-tight text-paper">
                    {c.name}
                  </h3>
                  <span
                    className={`inline-flex items-center rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider ${STYLE_BY_STATUS[c.status]}`}
                  >
                    {LABEL_BY_STATUS[c.status]}
                  </span>
                </div>
                <p className="mt-3 text-sm text-muted leading-relaxed">
                  {c.note}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
          <h2 className="font-display text-3xl sm:text-4xl tracking-tight">
            Past incidents
          </h2>
          <p className="mt-4 text-muted leading-relaxed">
            No incidents recorded yet. When something does break, a short
            write-up will go here — what happened, who was affected, what was
            done about it. For real-time chatter during an incident, the
            operator usually posts on{" "}
            <Link
              href="https://x.com/eri"
              target="_blank"
              rel="noopener noreferrer"
              className="text-paper underline underline-offset-4 decoration-white/30 transition hover:text-accent"
            >
              the eri X account
            </Link>
            .
          </p>
        </div>
      </section>

      <FooterBig />
    </main>
  );
}
