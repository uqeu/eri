type Availability = "now" | "soon";

interface Feature {
  title: string;
  body: string;
  icon: React.ReactNode;
  availability: Availability;
  signature?: boolean;
}

function Icon({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden
    >
      {children}
    </svg>
  );
}

const FEATURES: ReadonlyArray<Feature> = [
  {
    title: "Control anything, hands-free",
    body: "Open Discord, search YouTube, fix this file, join the call — say it or point with your eyes and eri operates your real apps. It confirms before anything risky, and one hotkey stops it cold.",
    availability: "soon",
    signature: true,
    icon: (
      <Icon>
        <path d="M5 3l14 9-6 1.5 3 6-2.5 1-3-6L5 19V3Z" />
      </Icon>
    ),
  },
  {
    title: "It sees what you see",
    body: "eri understands what's on your screen — the error, the form, the design — so you never re-explain. Faces are blurred on-device before anything is ever sent out.",
    availability: "soon",
    signature: true,
    icon: (
      <Icon>
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
      </Icon>
    ),
  },
  {
    title: "Talk naturally; it writes it clean",
    body: "Dictate anywhere. eri fixes the grammar, learns your vocabulary, expands your snippets, and turns rambling into polished text. Just say 'fix that word.'",
    availability: "now",
    signature: true,
    icon: (
      <Icon>
        <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" />
        <path d="M19 11a7 7 0 0 1-14 0" />
        <path d="M12 18v3" />
      </Icon>
    ),
  },
  {
    title: "It remembers you",
    body: "A private, on-device memory of how you work — your projects, habits, preferences — that anticipates. 'You usually open this next — want me to?'",
    availability: "now",
    signature: true,
    icon: (
      <Icon>
        <path d="M12 3a7 7 0 0 0-4 12.7V19a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-3.3A7 7 0 0 0 12 3Z" />
        <path d="M9 21h6" />
      </Icon>
    ),
  },
  {
    title: "It builds, too",
    body: "A full coding agent: it plans, edits across files, runs your tests, and ships. The same assistant that runs your computer also writes your software.",
    availability: "now",
    icon: (
      <Icon>
        <path d="M8 9l-4 3 4 3" />
        <path d="M16 9l4 3-4 3" />
        <path d="M13 5l-2 14" />
      </Icon>
    ),
  },
  {
    title: "Private by design",
    body: "Voice, gaze, and memory live on your machine. The cloud is used only when it genuinely helps — and you always see what left the device.",
    availability: "now",
    icon: (
      <Icon>
        <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z" />
        <path d="M9 12l2 2 4-4" />
      </Icon>
    ),
  },
  {
    title: "An MCP hub",
    body: "eri plugs into any Model Context Protocol server — and exposes its own tools as one, so Claude Desktop and other agents can call eri's memory and skills.",
    availability: "now",
    icon: (
      <Icon>
        <path d="M12 2l9 4.5v9L12 20l-9-4.5v-9L12 2Z" />
        <path d="M12 11l9-4.5" />
        <path d="M12 11v9" />
        <path d="M12 11L3 6.5" />
      </Icon>
    ),
  },
  {
    title: "Token-frugal",
    body: "eri reads the cheap signals first and only pays for the expensive model when it's worth it — so you get more out of your plan, automatically.",
    availability: "now",
    icon: (
      <Icon>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 7v10" />
        <path d="M9.5 9.5h3.5a1.75 1.75 0 0 1 0 3.5H9.5" />
      </Icon>
    ),
  },
];

function AvailabilityTag({ tag }: { tag: Availability }): React.ReactElement {
  if (tag === "now") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/[0.06] px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-accent">
        <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
        Available now
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.03] px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-muted">
      <span className="h-1.5 w-1.5 rounded-full bg-muted/70" aria-hidden />
      Coming soon
    </span>
  );
}

export function Features(): React.ReactElement {
  return (
    <section id="features" className="border-t border-white/[0.08]">
      <div className="mx-auto max-w-7xl px-6 py-24 sm:py-32">
        <div className="flex items-end justify-between gap-6 flex-wrap">
          <div className="max-w-3xl">
            <p className="text-xs uppercase tracking-[0.25em] text-muted">
              What eri does
            </p>
            <h2 className="mt-4 font-display text-3xl sm:text-5xl tracking-tight max-w-2xl text-balance font-normal">
              One agent for everything you do{" "}
              <span className="italic text-accent">on a computer.</span>
            </h2>
          </div>
          <p className="max-w-sm text-paper/60 text-[15px] leading-relaxed">
            Control, vision, voice, memory, and code — in one local-first agent
            that learns how you work.
          </p>
        </div>

        <div className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <article
              key={feature.title}
              className={`group relative rounded-lg border p-7 transition duration-300 ease-out-soft ${
                feature.signature
                  ? "border-accent/25 bg-accent/[0.025] hover:border-accent/50 hover:bg-accent/[0.05]"
                  : "border-white/[0.08] bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-md border transition-transform duration-300 group-hover:-translate-y-0.5 ${
                    feature.signature
                      ? "border-accent/30 bg-accent/10 text-accent"
                      : "border-white/[0.08] bg-white/[0.03] text-paper/80"
                  }`}
                  aria-hidden
                >
                  {feature.icon}
                </div>
                <AvailabilityTag tag={feature.availability} />
              </div>
              <h3 className="mt-6 font-display text-xl tracking-tight font-normal text-paper">
                {feature.title}
              </h3>
              <p className="mt-2 text-sm text-paper/60 leading-relaxed">
                {feature.body}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
