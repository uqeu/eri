import type { Metadata } from "next";
import { FooterBig } from "@/components/FooterBig";

export const metadata: Metadata = {
  title: "Releases — eri",
  description: "Versioned release notes for the eri desktop app.",
};

interface Release {
  readonly version: string;
  readonly codename: string;
  readonly date: string;
  readonly summary: string;
  readonly highlights: ReadonlyArray<string>;
  readonly fixes: ReadonlyArray<string>;
}

const RELEASES: ReadonlyArray<Release> = [
  {
    version: "0.4",
    codename: "Marlowe",
    date: "May 14, 2026",
    summary:
      "Current branch. The diffusion runtime finally clears four seconds end-to-end on the median Apple Silicon machine. Voice activity detection got a full rewrite.",
    highlights: [
      "Median voice-to-deploy time on M-series: 3.8s (down from 5.2s in 0.3).",
      "New lazy VAD with 40ms first-syllable latency and a 60% reduction in false wakeups.",
      "Multi-cursor edits across files now stream as a single coalesced diff.",
      "Gaze tracker re-trained on a 4× larger dataset; calibration time halved.",
      "BYOK support for Google AI Studio and any OpenAI-compatible endpoint.",
    ],
    fixes: [
      "Resolved a freeze when the wakeword detector lost its lease on the audio device.",
      "Stopped sending duplicate Sentry events when a panel was opened twice in one session.",
      "Fixed Cmd-K not focusing the input on first launch after a fresh install.",
    ],
  },
  {
    version: "0.3",
    codename: "Linnea",
    date: "March 6, 2026",
    summary:
      "First release with the iterator panel and the runtime spine split into eri_* crates. The internal team moved to dogfooding full-time on this build.",
    highlights: [
      "New iterator panel for stepping through long-running agent runs.",
      "Runtime spine refactored into five eri_* crates with clean boundaries.",
      "Cmd-K can now run any registered action across the editor and the agent.",
      "Local Llama backend wired up behind a feature flag for early testers.",
    ],
    fixes: [
      "Reduced startup memory by ~180 MB by deferring TTS warm-up.",
      "Fixed gaze calibration drift after long sessions with external monitors.",
      "Made the changelog feed survive a malformed entry instead of crashing the panel.",
    ],
  },
  {
    version: "0.2",
    codename: "Kerouac",
    date: "January 22, 2026",
    summary:
      "The first build we let strangers run. Onboarding now finishes in under sixty seconds and the editor reaches steady state on first launch.",
    highlights: [
      "End-to-end onboarding flow with mic, gaze, and project import wired together.",
      "Eri's engine now drives all multi-line edits by default.",
      "Editor surface holds 120 fps through full-file diffusion on the reference machine.",
      "Auto-update through the in-app channel switcher.",
    ],
    fixes: [
      "Closed a race where the voice pipeline could deadlock during a fast wake/sleep cycle.",
      "Stopped the agent from re-reading already-resolved errors in the same iteration.",
    ],
  },
  {
    version: "0.1",
    codename: "Jensen",
    date: "November 10, 2025",
    summary:
      "Internal-only alpha. First end-to-end voice → diffusion → diff loop running on a single laptop.",
    highlights: [
      "First working voice-to-diff pipeline.",
      "Minimal editor surface forked from VSCodium — keybindings and extensions carry over.",
      "Hand-rolled wakeword and TTS pipeline running entirely on-device.",
    ],
    fixes: [],
  },
];

export default function ReleasesPage() {
  return (
    <main>

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-20 sm:py-28">
          <p className="text-xs uppercase tracking-[0.25em] text-accent">
            Releases
          </p>
          <h1 className="mt-5 font-display text-4xl sm:text-6xl tracking-tight text-balance">
            What shipped, by version.
          </h1>
          <p className="mt-5 text-lg text-muted leading-relaxed">
            Tagged release notes for the eri desktop app. For day-by-day
            changes, the changelog is the better read.
          </p>
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
          <ul className="flex flex-col gap-16">
            {RELEASES.map((release) => (
              <li key={release.version}>
                <div className="flex flex-wrap items-baseline gap-3">
                  <span className="font-display text-3xl sm:text-4xl text-paper">
                    {release.version}
                  </span>
                  <span className="font-display text-lg text-paper/55">
                    “{release.codename}”
                  </span>
                  <span className="font-mono text-[11px] uppercase tracking-wider text-paper/40">
                    {release.date}
                  </span>
                </div>
                <p className="mt-4 text-muted leading-relaxed">
                  {release.summary}
                </p>

                <p className="mt-8 font-mono text-[11px] uppercase tracking-wider text-paper/50">
                  Highlights
                </p>
                <ul className="mt-3 flex flex-col gap-2 text-paper/90 leading-relaxed">
                  {release.highlights.map((item) => (
                    <li key={item} className="flex gap-3">
                      <span className="text-accent" aria-hidden>
                        +
                      </span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>

                {release.fixes.length > 0 && (
                  <>
                    <p className="mt-6 font-mono text-[11px] uppercase tracking-wider text-paper/50">
                      Fixes
                    </p>
                    <ul className="mt-3 flex flex-col gap-2 text-paper/80 leading-relaxed">
                      {release.fixes.map((item) => (
                        <li key={item} className="flex gap-3">
                          <span className="text-paper/40" aria-hidden>
                            ·
                          </span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <FooterBig />
    </main>
  );
}
