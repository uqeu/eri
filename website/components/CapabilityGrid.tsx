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
    id: "workbench",
    eyebrow: "Local first",
    label: "Workbench surfaces",
    items: [
      {
        title: "Installable local agent",
        body: "Runs on your machine, close to the work.",
        availability: "now",
        icon: (
          <Icon>
            <rect x="4" y="5" width="16" height="14" rx="2" />
            <path d="M8 9h8M8 13h5" />
            <path d="M12 19v2" />
          </Icon>
        ),
      },
      {
        title: "Terminal console",
        body: "Ask, run, inspect, and recover in shell.",
        availability: "now",
        icon: (
          <Icon>
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M7 9l3 3-3 3" />
            <path d="M13 15h5" />
          </Icon>
        ),
      },
      {
        title: "Agent Manager",
        body: "See active agents, queues, and handoffs.",
        availability: "now",
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
        title: "Cloud runners",
        body: "Send long jobs to managed background agents.",
        availability: "soon",
        icon: (
          <Icon>
            <path d="M7 18a5 5 0 1 1 1.4-9.8A6 6 0 0 1 20 11a4 4 0 0 1 0 7H7Z" />
          </Icon>
        ),
      },
      {
        title: "MCP and API tools",
        body: "Bring external tools with your own keys.",
        availability: "now",
        icon: (
          <Icon>
            <path d="M12 2l9 4.5v9L12 20l-9-4.5v-9L12 2Z" />
            <path d="M12 11l9-4.5M12 11v9M12 11L3 6.5" />
          </Icon>
        ),
      },
      {
        title: "Skill packs",
        body: "Teach repeatable workflows once, reuse them.",
        availability: "now",
        icon: (
          <Icon>
            <path d="M5 4h11l3 3v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" />
            <path d="M8 10h8M8 14h6M8 18h4" />
          </Icon>
        ),
      },
    ],
  },
  {
    id: "context",
    eyebrow: "Universal context",
    label: "Universal sources",
    items: [
      {
        title: "Repo reading",
        body: "Search files, symbols, diffs, and history.",
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
        title: "Universal search",
        body: "Find across local, web, docs, and tools.",
        availability: "now",
        icon: (
          <Icon>
            <circle cx="11" cy="11" r="7" />
            <path d="M16 16l5 5" />
          </Icon>
        ),
      },
      {
        title: "Document agent",
        body: "Summarize, compare, and cite project docs.",
        availability: "soon",
        icon: (
          <Icon>
            <path d="M5 4h11l3 3v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" />
            <path d="M8 9h7M8 13h7M8 17h4" />
          </Icon>
        ),
      },
      {
        title: "Dataset intake",
        body: "Attach tables, evals, traces, and examples.",
        availability: "soon",
        icon: (
          <Icon>
            <rect x="4" y="4" width="16" height="16" rx="2" />
            <path d="M4 10h16M4 16h16M10 4v16M16 4v16" />
          </Icon>
        ),
      },
      {
        title: "Tracer",
        body: "Follow decisions from prompt to command.",
        availability: "soon",
        icon: (
          <Icon>
            <circle cx="6" cy="6" r="2.5" />
            <circle cx="18" cy="12" r="2.5" />
            <circle cx="6" cy="18" r="2.5" />
            <path d="M8.3 7.2l9.4 4.6M17.7 13.2l-9.4 4.6" />
          </Icon>
        ),
      },
      {
        title: "Autosubscribe",
        body: "Keep watched repos and docs fresh.",
        availability: "soon",
        icon: (
          <Icon>
            <path d="M3 12a9 9 0 1 0 3-6.7" />
            <path d="M3 4v5h5" />
            <path d="M12 8v5l3 2" />
          </Icon>
        ),
      },
      {
        title: "Workspace sync",
        body: "Move context between local and cloud agents.",
        availability: "soon",
        icon: (
          <Icon>
            <path d="M7 7h11l-3-3" />
            <path d="M18 7l-3 3" />
            <path d="M17 17H6l3 3" />
            <path d="M6 17l3-3" />
          </Icon>
        ),
      },
      {
        title: "Private context",
        body: "Control what leaves your machine.",
        availability: "now",
        icon: (
          <Icon>
            <path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6l8-3Z" />
            <path d="M9 12l2 2 4-4" />
          </Icon>
        ),
      },
    ],
  },
  {
    id: "agent-loop",
    eyebrow: "From ask to ship",
    label: "Agent workflow",
    items: [
      {
        title: "Plan preview",
        body: "Review scope before an agent touches files.",
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
        title: "Multi-step agents",
        body: "Plan, edit, run, verify, and explain.",
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
        title: "Review queue",
        body: "Read diffs, risk, logs, and test output.",
        availability: "soon",
        icon: (
          <Icon>
            <path d="M4 5h13a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H8l-4 3V5Z" />
            <path d="M8 11h8M8 14h5" />
          </Icon>
        ),
      },
      {
        title: "Checkpoints",
        body: "Every turn can be inspected or rolled back.",
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
        title: "Ship actions",
        body: "Commit, branch, push, and open PRs.",
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
        title: "Human approval",
        body: "Commands and writes stay gated by consent.",
        availability: "now",
        icon: (
          <Icon>
            <path d="M5 12l4 4 10-10" />
          </Icon>
        ),
      },
    ],
  },
  {
    id: "artifacts",
    eyebrow: "Eri GenUI",
    label: "Artifacts and GenUI",
    items: [
      {
        title: "GenUI surfaces",
        body: "Agents create task-specific interfaces.",
        availability: "soon",
        icon: (
          <Icon>
            <rect x="3" y="3" width="18" height="18" rx="3" />
            <path d="M9 9h6v6" />
            <path d="M15 9l-6 6" />
          </Icon>
        ),
      },
      {
        title: "Live preview",
        body: "Inspect runnable outputs before applying.",
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
        title: "Artifact history",
        body: "Keep generated UIs, docs, and patches.",
        availability: "now",
        icon: (
          <Icon>
            <path d="M4 7h16M4 12h16M4 17h16" />
            <path d="M8 4v16M16 4v16" />
          </Icon>
        ),
      },
      {
        title: "Patch diffusion",
        body: "Watch changes resolve into reviewable diffs.",
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
    ],
  },
  {
    id: "interaction",
    eyebrow: "Hands free when useful",
    label: "Voice and vision",
    items: [
      {
        title: "Voice console",
        body: "Talk through local work without leaving flow.",
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
        title: "Gaze targeting",
        body: "Look at the thing; eri resolves context.",
        availability: "now",
        icon: (
          <Icon>
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
            <circle cx="12" cy="12" r="3" />
          </Icon>
        ),
      },
      {
        title: "Image input",
        body: "Drop screenshots, mocks, and diagrams.",
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
        title: "Multi-model routing",
        body: "Pick local or hosted models by task.",
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
                    category.id === "workbench"
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
                <span className="italic text-accent">one workbench.</span>
              </h2>
            </div>
            <p className="max-w-md text-paper/60 text-[15px] leading-relaxed">
              Local agents, terminal control, MCP tools, universal source
              reading, generated interfaces, review checkpoints, cloud handoff,
              and voice or gaze when hands-free context matters.
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
