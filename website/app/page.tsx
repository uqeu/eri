import { Eye, Mic, Brain, Search } from "lucide-react";
import { Hero } from "@/components/Hero";
import { CtaFooter } from "@/components/CtaFooter";
import { FooterBig } from "@/components/FooterBig";

const ICON = { size: 18, strokeWidth: 1.6 } as const;

// Not six capabilities competing for attention — four things the brain does
// *inside* Control. The pad in the hero is the demo; this is the quiet legend.
const FACETS: ReadonlyArray<{ icon: React.ReactNode; title: string; body: string }> = [
  {
    icon: <Eye {...ICON} />,
    title: "Sees your screen",
    body: "It reads the error, the form, the design you're looking at — so you never re-explain. Faces blur on-device before anything leaves.",
  },
  {
    icon: <Search {...ICON} />,
    title: "Answers in place",
    body: "Ask what something is, or send it to find out. It reads the results and hands you the answer, not ten open tabs.",
  },
  {
    icon: <Brain {...ICON} />,
    title: "Remembers you",
    body: "A private, on-device memory of how you work, so it gets ahead of you: “Your 2pm with Priya — the deck isn't attached yet.”",
  },
  {
    icon: <Mic {...ICON} />,
    title: "Writes it clean",
    body: "Dictate anywhere. It strips the fillers, fixes the grammar, learns your vocabulary, and turns rambling into polished text.",
  },
];

export default function HomePage(): React.ReactElement {
  return (
    <main>
      <Hero />

      <section className="relative pb-28 lg:pb-36">
        <div className="container">
          <div className="mb-14 max-w-2xl">
            <h2
              className="font-display text-h2 text-balance text-text"
              style={{ letterSpacing: "-0.02em", fontWeight: 500 }}
            >
              Two modes. One brain.
            </h2>
            <p className="mt-5 max-w-xl text-[16px] leading-relaxed text-text-sec">
              Either you're using eri to run your computer, or you're building
              with it. Everything else — seeing your screen, looking things up,
              remembering you, cleaning up your voice — happens inside Control,
              the moment you need it. Voice, gaze, and memory stay on your
              machine; the cloud is used only when it genuinely helps, and you
              always see what left the device.
            </p>
          </div>

          <div className="grid gap-x-10 gap-y-12 sm:grid-cols-2">
            {FACETS.map((f) => (
              <div key={f.title} className="flex gap-4">
                <span
                  className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] border border-border bg-white/[0.03] text-accent shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                  aria-hidden
                >
                  {f.icon}
                </span>
                <div>
                  <h3 className="text-[18px] font-medium tracking-[-0.01em] text-text">
                    {f.title}
                  </h3>
                  <p className="mt-2 max-w-sm text-[14.5px] leading-relaxed text-text-sec">
                    {f.body}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <CtaFooter />
      <FooterBig />
    </main>
  );
}
