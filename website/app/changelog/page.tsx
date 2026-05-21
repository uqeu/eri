import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { Footer } from "@/components/Footer";
import { ChangelogEntry } from "@/components/ChangelogEntry";

export const metadata: Metadata = {
  title: "Changelog — eri",
  description:
    "What shipped, when. eri changes fast — this is the running log.",
};

interface Entry {
  date: string;
  title: string;
  items: ReadonlyArray<string>;
}

const ENTRIES: ReadonlyArray<Entry> = [
  {
    date: "2026-05-17",
    title: "Native eri app, theming, Stripe billing, chat bots",
    items: [
      "Native macOS app — universal binary, signed and notarized",
      "Theme system with 12 curated themes and 21 typefaces",
      "Stripe billing live for Starter ($20) and Pro ($30) tiers",
      "Discord and Slack bots for shipping from chat",
      "Account dashboard with usage counters and data export",
    ],
  },
  {
    date: "2026-05-16",
    title: "eri's engine apply path, eri voice picker, eri.dev",
    items: [
      "Switched edit path to eri's engine — average iteration down to 1.7s",
      "eri voice picker via ElevenLabs presets for Starter+ tiers",
      "eri.dev landing page launched",
      "BYOK flow for Free tier (eri's engine + ElevenLabs keys)",
      "Iteration timelines shareable at /p/[slug]",
    ],
  },
  {
    date: "2026-05-14",
    title: "eri 0.1 — private alpha",
    items: [
      "Voice-first IDE loop end to end (transcribe → edit → apply → reload)",
      "Gaze targeting via MediaPipe sidecar",
      "One-shot ship to Vercel with Claude polish pass",
      "Iteration history with rollback to any prior state",
      "Invite-only alpha — 47 founding users",
    ],
  },
];

export default function ChangelogPage() {
  return (
    <main>
      <SiteHeader variant="solid" />

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-4xl px-6 py-20 sm:py-28">
          <p className="text-xs uppercase tracking-[0.25em] text-accent">
            Changelog
          </p>
          <h1 className="mt-5 font-display text-4xl sm:text-6xl tracking-tight text-balance">
            What we shipped.
          </h1>
          <p className="mt-5 max-w-xl text-lg text-muted leading-relaxed">
            We ship most weekdays. The big stuff lives here.
          </p>
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-4xl px-6 py-12 sm:py-16">
          {ENTRIES.map((entry) => (
            <ChangelogEntry
              key={entry.date}
              date={entry.date}
              title={entry.title}
              items={entry.items}
            />
          ))}
        </div>
      </section>

      <Footer />
    </main>
  );
}
