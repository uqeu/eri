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
    title: "Voice-driven editing",
    body: "Speak the change you want. eri transcribes locally, resolves your intent, and writes the patch before you finish the sentence.",
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
    title: "Diffusion preview",
    body: "See edits arrive as a denoising wash, not a typewriter crawl. The eri Engine lands multi-line patches in under two seconds.",
    availability: "now",
    signature: true,
    icon: (
      <Icon>
        <path d="M4 6h16" />
        <path d="M4 12h10" />
        <path d="M4 18h13" />
        <path d="M19 9l3 3-3 3" />
      </Icon>
    ),
  },
  {
    title: "Iteration history",
    body: "Every turn becomes a checkpoint. Scrub backward through prompts, diffs, and previews — recover any version of the file in one click.",
    availability: "now",
    signature: true,
    icon: (
      <Icon>
        <path d="M3 12a9 9 0 1 0 3-6.7" />
        <path d="M3 4v5h5" />
        <path d="M12 8v5l3 2" />
      </Icon>
    ),
  },
  {
    title: "Gaze targeting",
    body: "Look at the element you want changed. eri reads your webcam, locks onto the target, and resolves pronouns like 'this' or 'here'.",
    availability: "now",
    signature: true,
    icon: (
      <Icon>
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
      </Icon>
    ),
  },
  {
    title: "Tab completion",
    body: "Predictive multi-line suggestions that read your cursor, your imports, and the next likely move. Accept with a single tap.",
    availability: "now",
    icon: (
      <Icon>
        <path d="M4 7h11" />
        <path d="M11 3l4 4-4 4" />
        <path d="M20 12v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-5" />
      </Icon>
    ),
  },
  {
    title: "Cmd-K inline edit",
    body: "Highlight a span, hit Cmd-K, describe the change in plain English. The patch lands in the buffer with diff markers ready to apply.",
    availability: "now",
    icon: (
      <Icon>
        <rect x="3" y="3" width="18" height="18" rx="3" />
        <path d="M9 9h6v6" />
        <path d="M15 9l-6 6" />
      </Icon>
    ),
  },
  {
    title: "Composer",
    body: "Pin a goal, stream edits across many files at once, watch every diff land in a single review pane. Multi-file refactors without the tab dance.",
    availability: "now",
    icon: (
      <Icon>
        <rect x="3" y="4" width="8" height="7" rx="1.5" />
        <rect x="13" y="4" width="8" height="7" rx="1.5" />
        <rect x="3" y="13" width="8" height="7" rx="1.5" />
        <rect x="13" y="13" width="8" height="7" rx="1.5" />
      </Icon>
    ),
  },
  {
    title: "Agent mode",
    body: "Hand eri a goal and let it plan, edit, run, and verify across your repo. Every action is reviewable, every step is reversible.",
    availability: "soon",
    icon: (
      <Icon>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v3" />
        <path d="M12 19v3" />
        <path d="M4.2 4.2l2.1 2.1" />
        <path d="M17.7 17.7l2.1 2.1" />
        <path d="M2 12h3" />
        <path d="M19 12h3" />
        <path d="M4.2 19.8l2.1-2.1" />
        <path d="M17.7 6.3l2.1-2.1" />
      </Icon>
    ),
  },
  {
    title: "@-mentions",
    body: "Pull files, folders, web pages, docs, or the entire codebase into context with a single @. No copy-paste, no token games.",
    availability: "now",
    icon: (
      <Icon>
        <circle cx="12" cy="12" r="4" />
        <path d="M16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1" />
      </Icon>
    ),
  },
  {
    title: "Codebase indexing",
    body: "Local embeddings stay on your machine. eri finds the function you mean even when you describe it from three rooms away.",
    availability: "now",
    icon: (
      <Icon>
        <ellipse cx="12" cy="5" rx="8" ry="2.5" />
        <path d="M4 5v6c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5V5" />
        <path d="M4 11v6c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-6" />
      </Icon>
    ),
  },
  {
    title: "MCP support",
    body: "Plug any Model Context Protocol server into the loop — Slack, Linear, Postgres, your own internal tools. Bring the data, keep the keys.",
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
    title: "Multi-model routing",
    body: "Send edits to the eri Engine, polish to Claude, chat to GPT-4o, experiments to Gemini — all from one TOML. Or stay fully local with Llama.",
    availability: "now",
    icon: (
      <Icon>
        <circle cx="6" cy="6" r="2.5" />
        <circle cx="18" cy="6" r="2.5" />
        <circle cx="6" cy="18" r="2.5" />
        <circle cx="18" cy="18" r="2.5" />
        <path d="M8.5 6h7" />
        <path d="M6 8.5v7" />
        <path d="M18 8.5v7" />
        <path d="M8.5 18h7" />
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
              The surface
            </p>
            <h2 className="mt-4 font-display text-3xl sm:text-5xl tracking-tight max-w-2xl text-balance font-normal">
              Every Cursor reflex,{" "}
              <span className="italic text-accent">plus the ones it skipped.</span>
            </h2>
          </div>
          <p className="max-w-sm text-paper/60 text-[15px] leading-relaxed">
            eri matches Cursor feature-for-feature, then adds voice, gaze, and
            diffusion edits on top.
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
