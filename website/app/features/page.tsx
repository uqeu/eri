import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { CapabilityGrid } from "@/components/CapabilityGrid";

export const metadata: Metadata = {
  title: "Features — eri",
  description:
    "The complete eri feature catalog — local agents, terminal workbench, universal context, MCP tools, GenUI artifacts, review, checkpoints, and cloud handoff.",
};

interface MarqueeStat {
  value: string;
  label: string;
}

const MARQUEE_STATS: ReadonlyArray<MarqueeStat> = [
  { value: "28", label: "Total capabilities" },
  { value: "5", label: "Workbench layers" },
  { value: "8", label: "Source types" },
  { value: "3", label: "Run modes" },
];

export default function FeaturesPage(): React.ReactElement {
  return (
    <main>

      <section className="border-b border-white/[0.08]">
        <div className="mx-auto max-w-7xl px-6 py-20 sm:py-28">
          <p className="text-xs uppercase tracking-[0.25em] text-accent">
            Features
          </p>
          <h1 className="mt-5 font-display text-4xl sm:text-6xl tracking-tight max-w-3xl text-balance font-normal">
            An agentic local workbench for the way real work ships.
          </h1>
          <p className="mt-6 max-w-xl text-lg text-paper/70 leading-relaxed">
            eri installs as a local agent and terminal console, then connects
            MCP tools, APIs, skills, docs, datasets, traces, and cloud runners
            into one previewable loop: read, plan, build, review, checkpoint,
            and ship.
          </p>

          <div className="mt-12 grid gap-px overflow-hidden rounded-lg border border-white/[0.08] bg-white/[0.06] sm:grid-cols-4">
            {MARQUEE_STATS.map((stat) => (
              <div key={stat.label} className="bg-ink p-6">
                <div className="font-display text-3xl text-accent font-normal">
                  {stat.value}
                </div>
                <div className="mt-2 text-xs uppercase tracking-[0.18em] text-muted">
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <CapabilityGrid />

      <section className="border-t border-white/[0.08]">
        <div className="mx-auto max-w-7xl px-6 py-20 sm:py-28">
          <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-end sm:justify-between">
            <div className="max-w-2xl">
              <p className="text-xs uppercase tracking-[0.25em] text-muted">
                Next
              </p>
              <h2 className="mt-3 font-display text-3xl sm:text-4xl tracking-tight font-normal text-balance">
                See the loop in motion.
              </h2>
              <p className="mt-4 text-paper/65 leading-relaxed">
                Features are easier to feel than to read. The demo walks the
                local workbench, agent manager, context graph, generated UI, and
                ship loop in under three minutes.
              </p>
            </div>
            <Link
              href="/demo"
              className="inline-flex items-center gap-2 rounded-md border border-accent/40 bg-accent/[0.06] px-5 py-3 text-sm text-accent transition hover:border-accent hover:bg-accent/10"
            >
              <span aria-hidden>▶</span>
              Watch the demo
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
