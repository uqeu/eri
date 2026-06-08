import type { Metadata } from "next";
import { FooterBig } from "@/components/FooterBig";

export const metadata: Metadata = {
  title: "About — eri",
  description:
    "eri is a local agentic workbench for people who want code, CLI runs, and cloud handoff in one loop.",
};

interface Pillar {
  readonly title: string;
  readonly body: string;
}

const PILLARS: ReadonlyArray<Pillar> = [
  {
    title: "Intent is the input layer",
    body: "Some work starts as a sentence, some as a selected file, some as a terminal failure. eri turns that intent into a reviewed plan, a working diff, or the next command without making you leave the workspace.",
  },
  {
    title: "The loop is local",
    body: "Project files, edit history, voice transcription, command output, and review state live on your machine. Cloud services are an explicit handoff for work that needs remote compute, longer runs, or a hosted environment.",
  },
  {
    title: "The CLI is part of the product",
    body: "Agents should be able to inspect files, run commands, read failures, and propose the next step. eri treats the terminal as first-class context instead of a window you copy errors out of.",
  },
];

interface ManifestoLine {
  readonly tag: string;
  readonly text: string;
}

const MANIFESTO: ReadonlyArray<ManifestoLine> = [
  {
    tag: "01",
    text: "We don't want your repo on our servers. Your project lives on your laptop unless you deliberately hand off a task to cloud runtime.",
  },
  {
    tag: "02",
    text: "We don't want to sell your usage data. We don't have an ad model. We don't sell prompts, outputs, command logs, or telemetry. If we ever change this, we'll tell you in plain English first, not in a Terms update.",
  },
  {
    tag: "03",
    text: "We don't want invisible automation. Agent turns should show what changed, what ran, what failed, and what gets sent outside the machine before it leaves.",
  },
  {
    tag: "04",
    text: "We don't want surprise bills. Paid tiers are hard-capped at their monthly headline price. When you hit the cap, eri stops metered cloud turns instead of inventing an overage line item.",
  },
];

export default function AboutPage() {
  return (
    <main>

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-20 sm:py-28">
          <p className="text-xs uppercase tracking-[0.25em] text-accent">
            About
          </p>
          <h1 className="mt-5 font-display text-4xl sm:text-6xl tracking-tight text-balance">
            We're building the local workbench for agentic software work.
          </h1>
          <p className="mt-6 text-lg text-muted leading-relaxed">
            eri started as a side project: one engineer, a repo, and the hunch
            that serious agent work needed to live closer to the files,
            commands, and review habits developers already trust.
          </p>
        </div>
      </section>

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
          <h2 className="font-display text-3xl sm:text-4xl tracking-tight">
            Why eri exists
          </h2>
          <p className="mt-6 text-paper/90 leading-relaxed">
            The first wave of coding assistants made autocomplete dramatically
            better. The second wave gave us chat sidebars. Both still treated
            the terminal, editor, issue context, and deployment path as
            separate places. We think the useful frame is a workbench: one
            local loop where an agent can inspect, edit, run, explain, and ask
            before handing work to the cloud.
          </p>
          <p className="mt-5 text-paper/90 leading-relaxed">
            eri is not a generic editor skin or a wrapper around a remote API.
            It is a local product surface for agentic work: files, diffs,
            terminal output, task history, voice input, and cloud handoff
            arranged around the developer's review loop.
          </p>
        </div>
      </section>

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
          <p className="text-xs uppercase tracking-[0.25em] text-accent">
            Manifesto
          </p>
          <h2 className="mt-5 font-display text-3xl sm:text-4xl tracking-tight">
            Four things we won't do.
          </h2>
          <p className="mt-5 text-paper/85 leading-relaxed">
            We started eri because the tools we used every day kept making
            choices we wouldn't have made for ourselves. So we wrote them
            down. These are the four lines we don't blur.
          </p>
          <div className="mt-10 flex flex-col gap-7">
            {MANIFESTO.map((line) => (
              <div key={line.tag} className="flex gap-5">
                <span className="mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-accent/30 bg-accent/[0.08] font-mono text-[11px] text-accent">
                  {line.tag}
                </span>
                <p className="text-paper/85 leading-relaxed">{line.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
          <h2 className="font-display text-3xl sm:text-4xl tracking-tight">
            What we believe
          </h2>
          <div className="mt-10 flex flex-col gap-10">
            {PILLARS.map((pillar) => (
              <div key={pillar.title}>
                <h3 className="font-display text-xl tracking-tight text-paper">
                  {pillar.title}
                </h3>
                <p className="mt-3 text-muted leading-relaxed">{pillar.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
          <h2 className="font-display text-3xl sm:text-4xl tracking-tight">
            Who we are
          </h2>
          <p className="mt-6 text-paper/90 leading-relaxed">
            One person building in public. The weeks that went well and the
            weeks that didn&apos;t both get posted. Email gets answered.
            Fridays ship anyway.
          </p>
          <p className="mt-5 text-muted leading-relaxed">
            Based in Ontario, Canada. Independent. Self-funded. Provided
            as-is.
          </p>
        </div>
      </section>

      <FooterBig />
    </main>
  );
}
