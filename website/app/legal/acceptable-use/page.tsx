import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterBig } from "@/components/FooterBig";

export const metadata: Metadata = {
  title: "Acceptable use — eri",
  description:
    "What you can and can't do with eri. Short list of behaviour the operator will not tolerate.",
};

interface Section {
  readonly heading: string;
  readonly body: string;
}

const INTRO =
  "eri is a tool. Tools get misused. This page is the operator's line in the sand. Crossing it is grounds for account suspension and, where the law cares, a referral to whoever should hear about it.";

const FORBIDDEN: ReadonlyArray<string> = [
  "Generate, distribute, or operate malware, ransomware, spyware, stalkerware, or anything else designed to harm a computer or a person.",
  "Plan, encourage, or carry out violence; produce content that sexualises minors; create non-consensual sexual or intimate imagery of a real person; or harass, threaten, or dox someone.",
  "Build or operate systems for unlawful surveillance, biometric tracking without consent, or social-scoring of individuals.",
  "Infringe someone else's copyright, trademark, patent, or trade secret. Asking eri to recreate code you don't have a licence to use is on you.",
  "Generate deceptive content for fraud, impersonation, election interference, defamation, or other deceptive practices that target real people or institutions.",
  "Evade lawful sanctions, export controls, or the terms of service of a model provider you have connected via BYOK.",
  "Scrape, mirror, decompile, or reverse-engineer eri to clone it or to build a directly competing product. Studying it to learn from it is fine.",
  "Probe, scan, or stress-test the operator's infrastructure without permission. Responsible vulnerability reports go to security@tryeri.ca — there's a safe-harbour policy at /security/disclosure.",
  "Send abusive, spammy, or load-generating traffic to eri's services. One human, one account, normal use.",
  "Use eri to make life-critical or safety-critical decisions without a qualified human in the loop. Medical, legal, financial, emergency response — these are not what AI-assisted code generation is for.",
];

const SECTIONS: ReadonlyArray<Section> = [
  {
    heading: "1. Your responsibility",
    body: "You are responsible for what you make with eri. AI assistance does not shift legal responsibility to the operator or to the model provider — the output came out of your hands, in your account, on your machine. Treat AI-generated code the way you'd treat code from a stranger on the internet: read it, test it, own it.",
  },
  {
    heading: "2. Provider rules apply",
    body: "When you connect Anthropic, OpenAI, Google, or another model provider through BYOK, that provider's usage policy applies on top of this one. If they say no, the answer is no — even if eri's UI lets you ask.",
  },
  {
    heading: "3. Enforcement",
    body: "If the operator becomes aware of a likely violation, the response will be proportional: a warning, a temporary suspension, an account ban, or a referral to law enforcement. Severe cases (CSAM, credible threats of violence) get reported immediately. The operator may preserve records relevant to an investigation as long as the law requires.",
  },
  {
    heading: "4. Reporting abuse",
    body: "Saw something you think violates this policy? Email abuse@tryeri.ca with what you saw and a way to reach you. The operator will respond within a few business days. Good-faith reports do not get retaliated against.",
  },
  {
    heading: "5. Changes",
    body: "Reality changes; this list will change with it. Material updates get the same 30-day notice the Terms of Use uses. The revision date below tracks the current version.",
  },
];

export default function AcceptableUsePage() {
  return (
    <main>
      <SiteHeader variant="solid" />

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-20 sm:py-28">
          <p className="text-xs uppercase tracking-[0.25em] text-accent">
            Legal · Acceptable use
          </p>
          <h1 className="mt-5 font-display text-4xl sm:text-6xl tracking-tight text-balance">
            Don&apos;t be a problem.
          </h1>
          <p className="mt-5 text-lg text-muted leading-relaxed">{INTRO}</p>
          <p className="mt-6 font-mono text-[11px] uppercase tracking-wider text-paper/40">
            Last updated · May 21, 2026
          </p>
        </div>
      </section>

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
          <h2 className="font-display text-3xl sm:text-4xl tracking-tight">
            What you can&apos;t do
          </h2>
          <ul className="mt-8 flex flex-col gap-3">
            {FORBIDDEN.map((item) => (
              <li
                key={item}
                className="flex gap-3 text-paper/90 leading-relaxed"
              >
                <span aria-hidden className="text-accent">
                  —
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
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
