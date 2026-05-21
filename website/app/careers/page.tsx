import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterBig } from "@/components/FooterBig";

export const metadata: Metadata = {
  title: "Careers — eri",
  description:
    "We're hiring founding engineers, designers, and a GTM lead. Small team, real ownership, deep work.",
};

interface Role {
  readonly title: string;
  readonly location: string;
  readonly comp: string;
  readonly summary: string;
  readonly bullets: ReadonlyArray<string>;
}

const ROLES: ReadonlyArray<Role> = [
  {
    title: "Founding Engineer · Rust",
    location: "San Francisco or remote (Americas / EU overlap)",
    comp: "$220k–$280k + 0.8–1.6% equity",
    summary:
      "Own a slice of the runtime — diffusion bridging, voice pipeline, or the editor itself. You'll write Rust most days and ship to real users every week.",
    bullets: [
      "Design and implement a top-level eri_* crate end-to-end, with API surface, tests, and benchmarks you defend in review.",
      "Push the diffusion runtime closer to four-second deploys by attacking whichever bottleneck is in the way that week.",
      "Co-own the editor surface — performance, focus, and the parts of the UI that don't yet exist.",
      "Help us figure out what \"good\" voice-first input feels like when no one has shipped it before.",
      "Hold the bar on Rust correctness — propagate errors with `?`, refuse `unwrap()`, write the test before the abstraction.",
    ],
  },
  {
    title: "Founding Designer",
    location: "San Francisco strongly preferred",
    comp: "$180k–$240k + 0.6–1.4% equity",
    summary:
      "Define what a voice-first IDE looks and feels like. You'll work on the editor, the marketing site, the docs, and the way every surface fits together.",
    bullets: [
      "Set the visual and interaction language for eri across desktop, web, and onboarding flows.",
      "Prototype quickly in code or Figma — whichever lets us feel the answer faster — and ship to production.",
      "Lead the typography, motion, and density decisions that make eri feel like a tool, not a chat window.",
      "Sit with five users a week and watch what their hands and eyes actually do.",
      "Hire the second designer once we know what kind of designer we need.",
    ],
  },
  {
    title: "Founding GTM",
    location: "San Francisco",
    comp: "$170k–$220k + 0.4–1.0% equity",
    summary:
      "First non-engineering hire. Own the path from \"developer hears about eri\" to \"team standardizes on it\" — content, community, lifecycle, and the first revenue motion.",
    bullets: [
      "Build the early demand engine — long-form writing, video, partnerships, events, and whatever else moves the needle.",
      "Run point on the first 100 paying teams: onboard them, learn what they care about, feed it back to product.",
      "Stand up lifecycle, attribution, and an honest dashboard the whole team can read.",
      "Help us figure out pricing as we hit each new tier of usage.",
      "Hire the second GTM person once you know the playbook.",
    ],
  },
];

export default function CareersPage() {
  return (
    <main>
      <SiteHeader variant="solid" />

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-20 sm:py-28">
          <p className="text-xs uppercase tracking-[0.25em] text-accent">
            Careers
          </p>
          <h1 className="mt-5 font-display text-4xl sm:text-6xl tracking-tight text-balance">
            Help us build the IDE that listens.
          </h1>
          <p className="mt-5 text-lg text-muted leading-relaxed">
            We're hiring three founding roles. Small team, real ownership, deep
            work, and a product you'll actually use to do your job.
          </p>
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
          <ul className="flex flex-col gap-10">
            {ROLES.map((role) => (
              <li
                key={role.title}
                className="rounded-lg border border-white/10 bg-white/[0.02] p-8"
              >
                <h2 className="font-display text-2xl sm:text-3xl tracking-tight">
                  {role.title}
                </h2>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] uppercase tracking-wider text-paper/45">
                  <span>{role.location}</span>
                  <span aria-hidden>·</span>
                  <span>{role.comp}</span>
                </div>
                <p className="mt-5 text-muted leading-relaxed">
                  {role.summary}
                </p>
                <p className="mt-6 font-mono text-[11px] uppercase tracking-wider text-paper/50">
                  What you'll do
                </p>
                <ul className="mt-3 flex flex-col gap-2 text-paper/90 leading-relaxed">
                  {role.bullets.map((bullet) => (
                    <li key={bullet} className="flex gap-3">
                      <span className="text-accent" aria-hidden>
                        —
                      </span>
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-6 text-sm text-muted">
                  Apply by emailing{" "}
                  <a
                    href={`mailto:careers@eri.dev?subject=${encodeURIComponent(role.title)}`}
                    className="text-accent underline underline-offset-4"
                  >
                    careers@eri.dev
                  </a>{" "}
                  with a short note, your resume or LinkedIn, and one thing you
                  shipped you're proud of.
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="border-t border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-16">
          <h2 className="font-display text-3xl tracking-tight">
            Don't see your role?
          </h2>
          <p className="mt-4 text-muted leading-relaxed">
            We hire opportunistically. If you'd be a clear force-multiplier on
            the team, email{" "}
            <a
              href="mailto:careers@eri.dev"
              className="text-accent underline underline-offset-4"
            >
              careers@eri.dev
            </a>{" "}
            and tell us what you'd build.
          </p>
        </div>
      </section>

      <FooterBig />
    </main>
  );
}
