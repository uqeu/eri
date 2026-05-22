import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterBig } from "@/components/FooterBig";

export const metadata: Metadata = {
  title: "Vulnerability disclosure — eri",
  description:
    "How to report a security issue in eri, what's in scope, and the safe-harbour policy.",
};

interface Section {
  readonly heading: string;
  readonly body: string;
}

const SECTIONS: ReadonlyArray<Section> = [
  {
    heading: "1. How to report",
    body: "Email security@tryeri.ca with a clear description, reproduction steps, and the impact you observed. If the issue is sensitive, you can ask for a PGP key — the operator will reply with one. Please don't use the bug to access more data than necessary to demonstrate it.",
  },
  {
    heading: "2. What you can expect",
    body: "An acknowledgement within 3 business days. A triage assessment within 7 business days. A fix or a written explanation of why the report is not actionable. If your report results in a fix, the operator will credit you publicly (with your permission) once the patch is released. There is no bug bounty programme yet — that's honest, not a slight.",
  },
  {
    heading: "3. Safe harbour",
    body: "If you act in good faith, follow this policy, and avoid privacy violations, destruction of data, and interruption of service, the operator will not pursue legal action against you for security research on eri's published surfaces. This safe harbour does not extend to third-party infrastructure (your hosting provider, your model provider, the OS) — those are outside the operator's authority.",
  },
  {
    heading: "4. In scope",
    body: "The eri desktop application, the website at tryeri.ca, the dashboard at tryeri.ca/dashboard, and the public API endpoints documented at /docs. Vulnerabilities in third-party libraries are in scope only where the operator's specific use creates exploitability.",
  },
  {
    heading: "5. Out of scope",
    body: "Denial-of-service attacks. Social engineering of the operator. Physical attacks. Vulnerabilities in third-party services (Stripe, Supabase, Vercel, model providers) — report those upstream. Issues that require a compromised device, a malicious extension, or root access on the user's machine. Theoretical issues without a demonstrated impact path.",
  },
  {
    heading: "6. What not to do",
    body: "Don't exfiltrate other users' data. Don't pivot deeper than the bug requires. Don't publish the issue before a fix is shipped. Don't extort. Don't run automated scanners against production without coordinating first — the operator will share a test endpoint where useful.",
  },
  {
    heading: "7. After the fix",
    body: "Once a fix is shipped, the operator will publish a short security advisory (CVE if applicable) and credit you in it if you'd like to be named. If your finding affects user data, the operator will follow PIPEDA and applicable breach-notification laws to inform affected users.",
  },
];

export default function DisclosurePage() {
  return (
    <main>
      <SiteHeader variant="solid" />

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-20 sm:py-28">
          <p className="text-xs uppercase tracking-[0.25em] text-accent">
            Security · Disclosure
          </p>
          <h1 className="mt-5 font-display text-4xl sm:text-6xl tracking-tight text-balance">
            Found something? Tell the operator.
          </h1>
          <p className="mt-5 text-lg text-muted leading-relaxed">
            Responsible disclosure makes the product better. If you&apos;ve
            found a security issue in eri, this page is the contract between
            you and the operator: how to report, what&apos;s in scope, and the
            safe-harbour promise.
          </p>
          <div className="mt-8">
            <a
              href="mailto:security@tryeri.ca?subject=Vulnerability%20report"
              className="btn-primary inline-flex items-center gap-2 px-5 py-2.5 text-sm"
            >
              security@tryeri.ca <span aria-hidden>→</span>
            </a>
          </div>
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
