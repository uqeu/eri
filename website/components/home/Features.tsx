import {
  Eye,
  MousePointerClick,
  MessageSquare,
  AudioLines,
  Brain,
  Blocks,
  Code,
  Fingerprint,
} from "lucide-react";
import { Reveal } from "./Reveal";

// What eri does — capability stated as calm fact, each a declarative sentence
// with one concrete proof (the lab register). Cards reveal on scroll with a
// stagger. Light-techy: hairline glass, a single lime accent on the icon.

interface Feature {
  readonly icon: React.ReactNode;
  readonly title: string;
  readonly body: string;
}

const FEATURES: readonly Feature[] = [
  { icon: <Eye />, title: "It sees your screen.", body: "eri reads what’s in front of you, so you never explain twice." },
  { icon: <MousePointerClick />, title: "It works your computer.", body: "Clicks, types, books, sends — hands-free, and shows every step before it acts." },
  { icon: <MessageSquare />, title: "It texts you.", body: "The same eri in your messages, on time, from your pocket." },
  { icon: <AudioLines />, title: "It talks back.", body: "Speak to it and it answers out loud — a voice, not a transcript." },
  { icon: <Brain />, title: "It remembers you.", body: "What you do, say, and care about — a model of you that compounds." },
  { icon: <Blocks />, title: "It reaches your apps.", body: "A thousand of them, connected, doing the real work across your tools." },
  { icon: <Code />, title: "It builds your software.", body: "Plans across files, runs the tests, ships — through the same mind." },
  { icon: <Fingerprint />, title: "It learns only you.", body: "Not everyone, the same way. One person, deeply. You." },
];

export function Features(): React.ReactElement {
  return (
    <section className="bg-bg">
      <div className="mx-auto max-w-6xl px-6 py-24 lg:py-32">
        <Reveal>
          <h2 className="max-w-2xl text-balance font-display text-[clamp(1.9rem,4vw,3rem)] font-600 leading-[1.05] tracking-[-0.03em] text-text">
            everything it does, it does as one being.
          </h2>
        </Reveal>

        <div className="mt-14 grid gap-px overflow-hidden rounded-[18px] border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={(i % 4) * 70} className="bg-bg">
              <div className="group h-full p-7 transition-colors duration-300 hover:bg-bg-card">
                <span className="flex size-10 items-center justify-center rounded-xl bg-[rgba(170,200,20,0.12)] text-[#5a6a00] [&_svg]:size-[18px] [&_svg]:stroke-[2]">
                  {f.icon}
                </span>
                <h3 className="mt-5 font-display text-[1.12rem] font-600 leading-snug tracking-[-0.02em] text-text">
                  {f.title}
                </h3>
                <p className="mt-2 font-geist text-[14px] leading-relaxed text-text-sec">
                  {f.body}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
