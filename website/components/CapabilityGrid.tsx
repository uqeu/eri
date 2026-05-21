type Availability = "now" | "soon";

interface Capability {
  title: string;
  body: string;
  icon: React.ReactNode;
  availability: Availability;
}

interface Category {
  id: string;
  label: string;
  eyebrow: string;
  items: ReadonlyArray<Capability>;
}

function Icon({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? "h-4 w-4"}
      aria-hidden
    >
      {children}
    </svg>
  );
}

const CATEGORIES: ReadonlyArray<Category> = [
  {
    id: "differentiators",
    eyebrow: "Only in eri",
    label: "eri differentiators",
    items: [
      {
        title: "Voice-driven editing",
        body: "Local Whisper, sub-100ms turn taking.",
        availability: "now",
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
        body: "Patches arrive as a wash, not a crawl.",
        availability: "now",
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
        body: "Every turn is a reversible checkpoint.",
        availability: "now",
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
        body: "Look at the element. eri resolves it.",
        availability: "now",
        icon: (
          <Icon>
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
            <circle cx="12" cy="12" r="3" />
          </Icon>
        ),
      },
    ],
  },
  {
    id: "core-editing",
    eyebrow: "The keyboard surface",
    label: "Core editing",
    items: [
      {
        title: "Tab completion",
        body: "Predictive multi-line, accept with one key.",
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
        body: "Describe the change, watch the diff land.",
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
        title: "Apply",
        body: "One click to merge a streaming patch.",
        availability: "now",
        icon: (
          <Icon>
            <path d="M5 12l4 4 10-10" />
          </Icon>
        ),
      },
      {
        title: "Terminal AI",
        body: "Suggest commands, run them with consent.",
        availability: "soon",
        icon: (
          <Icon>
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M7 9l3 3-3 3" />
            <path d="M13 15h5" />
          </Icon>
        ),
      },
    ],
  },
  {
    id: "ai-surfaces",
    eyebrow: "Where the model meets you",
    label: "AI surfaces",
    items: [
      {
        title: "Chat panel",
        body: "Threaded conversation pinned to your repo.",
        availability: "now",
        icon: (
          <Icon>
            <path d="M21 12a8 8 0 0 1-12.3 6.8L3 21l2.2-5.7A8 8 0 1 1 21 12Z" />
          </Icon>
        ),
      },
      {
        title: "Composer",
        body: "Multi-file edits streamed into one review.",
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
        body: "Plan, edit, run, verify — all reviewable.",
        availability: "soon",
        icon: (
          <Icon>
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
            <path d="M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1" />
            <path d="M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
          </Icon>
        ),
      },
      {
        title: "Image input",
        body: "Drop a screenshot, get a working component.",
        availability: "now",
        icon: (
          <Icon>
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <circle cx="9" cy="11" r="1.8" />
            <path d="M21 16l-5-5-9 9" />
          </Icon>
        ),
      },
      {
        title: "Notepad",
        body: "Persistent scratchpad with live context.",
        availability: "soon",
        icon: (
          <Icon>
            <path d="M5 4h11l3 3v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" />
            <path d="M8 9h7M8 13h7M8 17h4" />
          </Icon>
        ),
      },
      {
        title: "Multi-model routing",
        body: "Per-task model selection from one TOML.",
        availability: "now",
        icon: (
          <Icon>
            <circle cx="6" cy="6" r="2.5" />
            <circle cx="18" cy="6" r="2.5" />
            <circle cx="6" cy="18" r="2.5" />
            <circle cx="18" cy="18" r="2.5" />
            <path d="M8.5 6h7M6 8.5v7M18 8.5v7M8.5 18h7" />
          </Icon>
        ),
      },
      {
        title: "Privacy mode",
        body: "Zero retention, no payload leaves your box.",
        availability: "now",
        icon: (
          <Icon>
            <path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6l8-3Z" />
            <path d="M9 12l2 2 4-4" />
          </Icon>
        ),
      },
      {
        title: "Cloud agents",
        body: "Hand off long jobs to a background runner.",
        availability: "soon",
        icon: (
          <Icon>
            <path d="M7 18a5 5 0 1 1 1.4-9.8A6 6 0 0 1 20 11a4 4 0 0 1 0 7H7Z" />
          </Icon>
        ),
      },
    ],
  },
  {
    id: "codebase",
    eyebrow: "Knowing the repo",
    label: "Codebase intelligence",
    items: [
      {
        title: "@-mentions",
        body: "Pull files, folders, web, docs into context.",
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
        body: "Local embeddings, semantic-grade search.",
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
        title: "Web search",
        body: "Live results stitched into the prompt.",
        availability: "now",
        icon: (
          <Icon>
            <circle cx="12" cy="12" r="9" />
            <path d="M3 12h18" />
            <path d="M12 3a14 14 0 0 1 0 18" />
            <path d="M12 3a14 14 0 0 0 0 18" />
          </Icon>
        ),
      },
      {
        title: "Documentation lookup",
        body: "Pin @docs to any framework or package.",
        availability: "now",
        icon: (
          <Icon>
            <path d="M4 4h12a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4V4Z" />
            <path d="M4 16a4 4 0 0 1 4-4h12" />
          </Icon>
        ),
      },
      {
        title: "Custom rules",
        body: "Ship project guidelines via .erirules.",
        availability: "now",
        icon: (
          <Icon>
            <path d="M5 4h11l3 3v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" />
            <path d="M8 10h8M8 14h6" />
          </Icon>
        ),
      },
      {
        title: "MCP servers",
        body: "Bring any tool, keep your own keys.",
        availability: "now",
        icon: (
          <Icon>
            <path d="M12 2l9 4.5v9L12 20l-9-4.5v-9L12 2Z" />
            <path d="M12 11l9-4.5M12 11v9M12 11L3 6.5" />
          </Icon>
        ),
      },
      {
        title: "Bug finder",
        body: "Continuous review, ranked by blast radius.",
        availability: "soon",
        icon: (
          <Icon>
            <rect x="6" y="7" width="12" height="12" rx="6" />
            <path d="M9 7V5a3 3 0 0 1 6 0v2" />
            <path d="M3 12h3M18 12h3M5 18l2-1M19 18l-2-1M5 7l2 1M19 7l-2 1" />
          </Icon>
        ),
      },
      {
        title: "Linter integration",
        body: "Diagnostics rolled into every suggestion.",
        availability: "soon",
        icon: (
          <Icon>
            <path d="M12 3l9 6v6l-9 6-9-6V9l9-6Z" />
            <path d="M9 12l2 2 4-4" />
          </Icon>
        ),
      },
    ],
  },
  {
    id: "collab",
    eyebrow: "Out of the editor",
    label: "Collaboration",
    items: [
      {
        title: "Git integration",
        body: "Auto commit messages, branch automation.",
        availability: "now",
        icon: (
          <Icon>
            <circle cx="6" cy="6" r="2.5" />
            <circle cx="6" cy="18" r="2.5" />
            <circle cx="18" cy="12" r="2.5" />
            <path d="M6 8.5v7" />
            <path d="M6 12h7" />
            <path d="M15.5 12H13" />
          </Icon>
        ),
      },
      {
        title: "Pull requests",
        body: "Open a PR with a real change summary.",
        availability: "soon",
        icon: (
          <Icon>
            <circle cx="6" cy="6" r="2.5" />
            <circle cx="6" cy="18" r="2.5" />
            <circle cx="18" cy="18" r="2.5" />
            <path d="M6 8.5v7" />
            <path d="M18 15.5V12a3 3 0 0 0-3-3h-3" />
            <path d="M14 7l-2 2 2 2" />
          </Icon>
        ),
      },
      {
        title: "Branch automation",
        body: "Spawn, switch, and clean up by intent.",
        availability: "soon",
        icon: (
          <Icon>
            <path d="M6 4v16" />
            <circle cx="6" cy="6" r="2" />
            <path d="M6 12c0 3 3 3 6 3a4 4 0 0 0 4-4" />
            <circle cx="16" cy="6" r="2" />
          </Icon>
        ),
      },
      {
        title: "Code review",
        body: "Read your diffs back with annotated risk.",
        availability: "soon",
        icon: (
          <Icon>
            <path d="M4 5h13a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H8l-4 3V5Z" />
            <path d="M8 11h8M8 14h5" />
          </Icon>
        ),
      },
    ],
  },
];

const TOTAL_FEATURES = CATEGORIES.reduce(
  (sum, category) => sum + category.items.length,
  0,
);

function AvailabilityDot({ tag }: { tag: Availability }): React.ReactElement {
  if (tag === "now") {
    return (
      <span
        className="inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-accent shadow-[0_0_8px_rgba(224,255,79,0.6)]"
        aria-label="Available now"
      />
    );
  }
  return (
    <span
      className="inline-flex h-1.5 w-1.5 shrink-0 rounded-full border border-muted/60"
      aria-label="Coming soon"
    />
  );
}

interface CategoryBlockProps {
  category: Category;
  index: number;
}

function CategoryBlock({ category, index }: CategoryBlockProps): React.ReactElement {
  return (
    <section id={category.id} className="border-t border-white/[0.08]">
      <div className="mx-auto max-w-7xl px-6 py-16 sm:py-20">
        <div className="flex items-baseline justify-between gap-6 flex-wrap">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-muted">
              {category.eyebrow}
            </p>
            <h2 className="mt-3 font-display text-2xl sm:text-4xl tracking-tight font-normal text-paper">
              {category.label}
            </h2>
          </div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">
            {String(index + 1).padStart(2, "0")} / {String(CATEGORIES.length).padStart(2, "0")}
          </p>
        </div>

        <div className="mt-10 grid gap-px overflow-hidden rounded-lg border border-white/[0.08] bg-white/[0.06] sm:grid-cols-2 lg:grid-cols-4">
          {category.items.map((item) => (
            <article
              key={item.title}
              className="group relative bg-ink p-6 transition duration-300 hover:bg-white/[0.025]"
            >
              <div className="flex items-start justify-between gap-3">
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-md border transition-transform duration-300 group-hover:-translate-y-0.5 ${
                    category.id === "differentiators"
                      ? "border-accent/30 bg-accent/10 text-accent"
                      : "border-white/[0.08] bg-white/[0.03] text-paper/80"
                  }`}
                  aria-hidden
                >
                  {item.icon}
                </div>
                <AvailabilityDot tag={item.availability} />
              </div>
              <h3 className="mt-5 font-display text-lg tracking-tight font-normal text-paper">
                {item.title}
              </h3>
              <p className="mt-1.5 text-sm text-paper/55 leading-relaxed">
                {item.body}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export function CapabilityGrid(): React.ReactElement {
  return (
    <div id="capabilities">
      <section className="border-t border-white/[0.08]">
        <div className="mx-auto max-w-7xl px-6 py-20 sm:py-28">
          <div className="flex items-end justify-between gap-6 flex-wrap">
            <div className="max-w-3xl">
              <p className="text-xs uppercase tracking-[0.25em] text-muted">
                The full catalog
              </p>
              <h2 className="mt-4 font-display text-3xl sm:text-5xl tracking-tight max-w-2xl text-balance font-normal">
                {TOTAL_FEATURES} capabilities,{" "}
                <span className="italic text-accent">one editor.</span>
              </h2>
            </div>
            <p className="max-w-md text-paper/60 text-[15px] leading-relaxed">
              Cursor-parity across the keyboard, AI surfaces, codebase
              intelligence, and collaboration — with voice, gaze, diffusion, and
              iteration history layered on top.
            </p>
          </div>

          <div className="mt-10 flex flex-wrap gap-2 font-mono text-[11px] uppercase tracking-[0.18em]">
            {CATEGORIES.map((category) => (
              <a
                key={category.id}
                href={`#${category.id}`}
                className="rounded-full border border-white/[0.08] bg-white/[0.02] px-3 py-1.5 text-paper/70 transition hover:border-accent/40 hover:text-accent"
              >
                {category.label}
                <span className="ml-2 text-muted">{category.items.length}</span>
              </a>
            ))}
          </div>
        </div>
      </section>

      {CATEGORIES.map((category, index) => (
        <CategoryBlock key={category.id} category={category} index={index} />
      ))}
    </div>
  );
}
