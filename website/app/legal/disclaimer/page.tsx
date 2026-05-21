import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterBig } from "@/components/FooterBig";

export const metadata: Metadata = {
  title: "Disclaimer — eri",
  description:
    "eri is provided as-is by an independent developer. No warranties, no SLAs, use at your own risk.",
};

export default function DisclaimerPage() {
  return (
    <main>
      <SiteHeader variant="solid" />

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-20 sm:py-28">
          <p className="text-xs uppercase tracking-[0.25em] text-accent">
            Legal · Disclaimer
          </p>
          <h1 className="mt-5 font-display text-4xl sm:text-6xl tracking-tight text-balance">
            Use at your own risk.
          </h1>
          <p className="mt-5 text-lg text-muted leading-relaxed">
            eri is an independent project. The operator is one person doing
            their best. This page exists so there is nothing left to read
            between the lines.
          </p>
          <p className="mt-6 font-mono text-[11px] uppercase tracking-wider text-paper/40">
            Last updated · May 21, 2026
          </p>
        </div>
      </section>

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
          <div className="flex flex-col gap-10">
            <div>
              <h2 className="font-display text-xl sm:text-2xl tracking-tight text-paper">
                No warranty
              </h2>
              <p className="mt-3 text-muted leading-relaxed">
                eri is provided &quot;AS IS&quot; and &quot;AS AVAILABLE&quot;,
                without warranty of any kind, express or implied. That includes
                — but is not limited to — implied warranties of
                merchantability, fitness for a particular purpose,
                non-infringement, security, accuracy of AI output, or
                uninterrupted operation.
              </p>
            </div>

            <div>
              <h2 className="font-display text-xl sm:text-2xl tracking-tight text-paper">
                No SLA
              </h2>
              <p className="mt-3 text-muted leading-relaxed">
                There is no uptime promise. The desktop app can keep working
                for local features while the cloud is down, but the cloud side
                may be unavailable at any time, for any reason, including the
                operator being asleep. Don&apos;t build production dependencies
                on eri.
              </p>
            </div>

            <div>
              <h2 className="font-display text-xl sm:text-2xl tracking-tight text-paper">
                AI output is not advice
              </h2>
              <p className="mt-3 text-muted leading-relaxed">
                Nothing eri produces should be treated as legal, financial,
                medical, security, or other professional advice. AI-generated
                code can contain bugs, vulnerabilities, licensing pitfalls, and
                straight-up hallucinations. Review every line. See{" "}
                <Link
                  href="/legal/ai-policy"
                  className="text-paper underline underline-offset-4 decoration-white/30 transition hover:text-accent"
                >
                  the AI use policy
                </Link>{" "}
                for the longer story.
              </p>
            </div>

            <div>
              <h2 className="font-display text-xl sm:text-2xl tracking-tight text-paper">
                Third-party providers are their own thing
              </h2>
              <p className="mt-3 text-muted leading-relaxed">
                When you connect Anthropic, OpenAI, Google, or any other
                provider with your own keys, your relationship with that
                provider is yours alone. The operator does not control their
                output, their uptime, their content policies, or their
                billing.
              </p>
            </div>

            <div>
              <h2 className="font-display text-xl sm:text-2xl tracking-tight text-paper">
                Limitation of liability
              </h2>
              <p className="mt-3 text-muted leading-relaxed">
                To the maximum extent permitted by law, the operator is not
                liable for any indirect, incidental, special, consequential, or
                punitive damages — including lost profits, lost data, business
                interruption, regulatory fines, or harm caused by AI-generated
                output. Total aggregate liability for any direct claim is
                capped at the greater of CAD&nbsp;$100 or the amount you paid
                the operator in the prior three months.
              </p>
            </div>

            <div>
              <h2 className="font-display text-xl sm:text-2xl tracking-tight text-paper">
                Where consumer law gives you more
              </h2>
              <p className="mt-3 text-muted leading-relaxed">
                Some jurisdictions don&apos;t allow certain limitations of
                liability or implied warranties. In those places, this
                disclaimer applies to the maximum extent the law allows, and
                nothing here removes a right you have under mandatory consumer
                protection rules.
              </p>
            </div>

            <div>
              <h2 className="font-display text-xl sm:text-2xl tracking-tight text-paper">
                If you don&apos;t accept any of this
              </h2>
              <p className="mt-3 text-muted leading-relaxed">
                Don&apos;t install eri, don&apos;t sign in, don&apos;t use the
                cloud features. That&apos;s the only deal on offer.
              </p>
            </div>
          </div>
        </div>
      </section>

      <FooterBig />
    </main>
  );
}
