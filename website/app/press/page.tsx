import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { FooterBig } from "@/components/FooterBig";

export const metadata: Metadata = {
  title: "Press — eri",
  description:
    "Press kit, boilerplate, and brand assets for journalists covering eri.",
};

interface Fact {
  readonly label: string;
  readonly value: string;
}

const FACTS: ReadonlyArray<Fact> = [
  { label: "Founded", value: "2025" },
  { label: "Headquarters", value: "San Francisco, California" },
  { label: "Team size", value: "Under twenty" },
  { label: "Stage", value: "Privately held" },
  { label: "Product", value: "eri — voice-first IDE for macOS" },
  { label: "Current build", value: "0.4.1" },
];

interface Asset {
  readonly name: string;
  readonly format: string;
  readonly note: string;
}

const ASSETS: ReadonlyArray<Asset> = [
  {
    name: "Wordmark (paper on ink)",
    format: "SVG · PNG @2x",
    note: "Use on dark backgrounds. Do not stretch or recolor.",
  },
  {
    name: "Wordmark (ink on paper)",
    format: "SVG · PNG @2x",
    note: "Use on light backgrounds. Maintain 1× cap-height clearspace.",
  },
  {
    name: "Mark (accent dot)",
    format: "SVG · PNG @2x",
    note: "Use only when the wordmark appears nearby in the same view.",
  },
  {
    name: "Product screenshots",
    format: "PNG · MP4 (silent loop)",
    note: "Latest build. Free to use in editorial coverage with credit.",
  },
];

export default function PressPage() {
  return (
    <main>
      <SiteHeader variant="solid" />

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-20 sm:py-28">
          <p className="text-xs uppercase tracking-[0.25em] text-accent">
            Press
          </p>
          <h1 className="mt-5 font-display text-4xl sm:text-6xl tracking-tight text-balance">
            Press kit.
          </h1>
          <p className="mt-5 text-lg text-muted leading-relaxed">
            Everything a journalist needs to write about eri accurately:
            boilerplate, fast facts, and downloadable brand assets.
          </p>
        </div>
      </section>

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
          <h2 className="font-display text-3xl sm:text-4xl tracking-tight">
            About eri
          </h2>
          <p className="mt-6 text-paper/90 leading-relaxed">
            eri is a voice-first IDE for solo founders and small product teams.
            Native to macOS, built in Rust, and powered by a diffusion code
            model, eri turns spoken intent into a working diff in under four
            seconds. Voice, gaze, and the editor run locally; only model calls
            leave the device.
          </p>
          <p className="mt-5 text-paper/90 leading-relaxed">
            The company was founded in 2025 in San Francisco and is privately
            held.
          </p>
        </div>
      </section>

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
          <h2 className="font-display text-3xl sm:text-4xl tracking-tight">
            Fast facts
          </h2>
          <dl className="mt-8 divide-y divide-white/10 border-y border-white/10">
            {FACTS.map((fact) => (
              <div
                key={fact.label}
                className="flex items-center justify-between gap-6 py-4"
              >
                <dt className="font-mono text-[11px] uppercase tracking-wider text-paper/45">
                  {fact.label}
                </dt>
                <dd className="text-paper">{fact.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
          <h2 className="font-display text-3xl sm:text-4xl tracking-tight">
            Brand assets
          </h2>
          <p className="mt-4 text-muted leading-relaxed">
            Downloads will be linked here once the press kit lands on the CDN.
            In the meantime, email{" "}
            <a
              href="mailto:press@eri.dev"
              className="text-accent underline underline-offset-4"
            >
              press@eri.dev
            </a>{" "}
            and we'll send a zip.
          </p>
          <ul className="mt-8 flex flex-col gap-3">
            {ASSETS.map((asset) => (
              <li
                key={asset.name}
                className="flex flex-col gap-1 rounded-lg border border-white/10 bg-white/[0.02] p-5"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <span className="font-display text-lg text-paper">
                    {asset.name}
                  </span>
                  <span className="font-mono text-[11px] uppercase tracking-wider text-paper/45">
                    {asset.format}
                  </span>
                </div>
                <span className="text-sm text-muted">{asset.note}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
          <h2 className="font-display text-3xl sm:text-4xl tracking-tight">
            Media inquiries
          </h2>
          <p className="mt-4 text-muted leading-relaxed">
            Reach the press team at{" "}
            <a
              href="mailto:press@eri.dev"
              className="text-accent underline underline-offset-4"
            >
              press@eri.dev
            </a>
            . We try to reply within one business day. For deadline coverage,
            put the deadline in the subject line and we'll prioritize.
          </p>
        </div>
      </section>

      <FooterBig />
    </main>
  );
}
