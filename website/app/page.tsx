import { MousePointer2, Eye, Mic, Brain, Code2, Search } from "lucide-react";
import { Hero } from "@/components/Hero";
import { CapabilityRow, type CapabilityRowProps } from "@/components/CapabilityRow";
import { CtaFooter } from "@/components/CtaFooter";
import { FooterBig } from "@/components/FooterBig";

const ICON = { size: 20, strokeWidth: 1.6 } as const;

// The six capabilities, each demoed by the live pad locked to its own scene.
// Privacy isn't a row — it's a property, stated in the lead, not faked as a demo.
const ROWS: ReadonlyArray<Omit<CapabilityRowProps, "flip">> = [
  {
    focus: "control",
    icon: <MousePointer2 {...ICON} />,
    title: "Control anything, hands-free",
    body: "Open the app, search the web, fix the file, join the call — say it or point with your eyes and eri operates your real apps. It confirms before anything risky, and one hotkey stops it cold.",
  },
  {
    focus: "eyes",
    icon: <Eye {...ICON} />,
    title: "It sees what you see",
    body: "eri understands what's on your screen — the error, the form, the design — so you never re-explain. Faces are blurred on-device before anything is ever sent out.",
  },
  {
    focus: "voice",
    icon: <Mic {...ICON} />,
    title: "Talk; it writes it clean",
    body: "Dictate anywhere. eri fixes the grammar, learns your vocabulary, expands your snippets, and turns rambling into polished text. Just say “fix that word.”",
  },
  {
    focus: "memory",
    icon: <Brain {...ICON} />,
    title: "It remembers you",
    body: "A private, on-device memory of how you work — your projects, habits, and the thread of your day — so it gets ahead of you: “Your 2pm with Priya, the deck isn’t attached yet. Want me to?”",
  },
  {
    focus: "build",
    icon: <Code2 {...ICON} />,
    title: "It builds, too",
    body: "A full coding agent: it plans, edits across files, runs your tests, and ships. The same assistant that runs your computer also writes your software.",
  },
  {
    focus: "research",
    icon: <Search {...ICON} />,
    title: "It looks things up",
    body: "Ask what something is, or send it to go find out. eri searches the web, reads the results, and hands you the answer — not ten open tabs.",
  },
];

export default function HomePage(): React.ReactElement {
  return (
    <main>
      <Hero />

      <section className="relative pb-28 lg:pb-36">
        <div className="container">
          <div className="mb-16 max-w-2xl lg:mb-24">
            <h2
              className="font-display text-h2 text-balance text-text"
              style={{ letterSpacing: "-0.02em", fontWeight: 500 }}
            >
              Everything you do on a computer — in one place.
            </h2>
            <p className="mt-5 max-w-xl text-[16px] leading-relaxed text-text-sec">
              Control, vision, voice, memory, code, and research — a single
              local-first agent that learns how you work and gets sharper every
              day. Voice, gaze, and memory stay on your machine; the cloud is
              used only when it genuinely helps, and you always see what left the
              device.
            </p>
          </div>

          <div className="flex flex-col gap-24 lg:gap-32">
            {ROWS.map((row, i) => (
              <CapabilityRow key={row.focus} {...row} flip={i % 2 === 1} />
            ))}
          </div>
        </div>
      </section>

      <CtaFooter />
      <FooterBig />
    </main>
  );
}
