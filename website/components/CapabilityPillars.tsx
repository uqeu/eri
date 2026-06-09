import {
  MousePointer2,
  Eye,
  Mic,
  Brain,
  Code2,
  ShieldCheck,
} from "lucide-react";

type Availability = "now" | "soon";

const ICON = { size: 19, strokeWidth: 1.6 } as const;

interface Pillar {
  readonly title: string;
  readonly body: string;
  readonly availability: Availability;
  readonly icon: React.ReactNode;
}

const PILLARS: ReadonlyArray<Pillar> = [
  {
    title: "Control anything, hands-free",
    body: "Open the app, search the web, fix the file, join the call — say it or point with your eyes and eri operates your real apps. It confirms before anything risky, and one hotkey stops it cold.",
    availability: "soon",
    icon: <MousePointer2 {...ICON} />,
  },
  {
    title: "It sees what you see",
    body: "eri understands what's on your screen — the error, the form, the design — so you never re-explain. Faces are blurred on-device before anything is ever sent out.",
    availability: "soon",
    icon: <Eye {...ICON} />,
  },
  {
    title: "Talk; it writes it clean",
    body: "Dictate anywhere. eri fixes the grammar, learns your vocabulary, expands your snippets, and turns rambling into polished text. Just say “fix that word.”",
    availability: "now",
    icon: <Mic {...ICON} />,
  },
  {
    title: "It remembers you",
    body: "A private, on-device memory of how you work — your projects, habits, preferences, the thread of your day — so it gets ahead of you. “Your 2pm with Priya — the deck isn't attached yet. Want me to?”",
    availability: "now",
    icon: <Brain {...ICON} />,
  },
  {
    title: "It builds, too",
    body: "A full coding agent: it plans, edits across files, runs your tests, and ships. The same assistant that runs your computer also writes your software.",
    availability: "now",
    icon: <Code2 {...ICON} />,
  },
  {
    title: "Private by design",
    body: "Voice, gaze, and memory live on your machine. The cloud is used only when it genuinely helps — and you always see what left the device.",
    availability: "now",
    icon: <ShieldCheck {...ICON} />,
  },
];

function Tag({ tag }: { tag: Availability }): React.ReactElement {
  const isNow = tag === "now";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] ${
        isNow
          ? "border-border-strong text-text-sec"
          : "border-border text-text-ter"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          isNow ? "bg-text-sec" : "bg-text-ter"
        }`}
        aria-hidden
      />
      {isNow ? "Available" : "Coming soon"}
    </span>
  );
}

export function CapabilityPillars(): React.ReactElement {
  return (
    <section className="relative mb-24 lg:mb-32">
      {/* Ambient lime glow behind the grid — Warp-style depth. */}
      <div
        className="section-glow"
        style={{
          background:
            "radial-gradient(46% 40% at 50% 0%, rgba(255,255,255,0.035) 0%, rgba(224,255,79,0.035) 40%, transparent 72%)",
        }}
        aria-hidden
      />

      <div className="container relative">
        <div className="mb-12">
          <span className="inline-block rounded-full border border-border px-3 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-text-sec mb-5">
            One agent
          </span>
          <h2
            className="font-display text-h2 text-balance max-w-2xl text-text"
            style={{ letterSpacing: "-0.02em", fontWeight: 500 }}
          >
            Everything you do on a computer — in one place.
          </h2>
          <p className="mt-4 max-w-xl text-text-sec text-[15px] leading-relaxed">
            Control, vision, voice, memory, and code — a single local-first agent
            that learns how you work and gets sharper every day.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PILLARS.map((pillar) => (
            <article key={pillar.title} className="glass-soft group p-7">
              <div className="flex items-start justify-between gap-3">
                <div
                  className="flex h-11 w-11 items-center justify-center rounded-[10px] border border-border bg-white/[0.03] text-text shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition-transform duration-300 group-hover:-translate-y-0.5"
                  aria-hidden
                >
                  {pillar.icon}
                </div>
                <Tag tag={pillar.availability} />
              </div>
              <h3 className="mt-6 font-display text-xl tracking-tight font-normal text-text">
                {pillar.title}
              </h3>
              <p className="mt-2 text-sm text-text-sec leading-relaxed">
                {pillar.body}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
