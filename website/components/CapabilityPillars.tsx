type Availability = "now" | "soon";

interface Pillar {
  readonly title: string;
  readonly body: string;
  readonly availability: Availability;
  readonly icon: React.ReactNode;
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

const PILLARS: ReadonlyArray<Pillar> = [
  {
    title: "Control anything, hands-free",
    body: "Open the app, search the web, fix the file, join the call — say it or point with your eyes and eri operates your real apps. It confirms before anything risky, and one hotkey stops it cold.",
    availability: "soon",
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
    icon: (
      <Icon>
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
      </Icon>
    ),
  },
  {
    title: "Talk; it writes it clean",
    body: "Dictate anywhere. eri fixes the grammar, learns your vocabulary, expands your snippets, and turns rambling into polished text. Just say “fix that word.”",
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
    title: "It remembers you",
    body: "A private, on-device memory of how you work — your projects, habits, preferences — that anticipates. “You usually open this next — want me to?”",
    availability: "now",
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
    <section className="container mb-24 lg:mb-32">
      <div className="mb-10 border-t border-border pt-10">
        <span className="inline-block rounded-full border border-border px-3 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-text-sec mb-5">
          One agent
        </span>
        <h2
          className="text-h2 text-balance max-w-2xl text-text"
          style={{ letterSpacing: "-0.02em", fontWeight: 500 }}
        >
          Everything you do on a computer — in one place.
        </h2>
        <p className="mt-4 max-w-xl text-text-sec text-[15px] leading-relaxed">
          Control, vision, voice, memory, and code — a single local-first agent
          that learns how you work and gets sharper every day.
        </p>
      </div>

      <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
        {PILLARS.map((pillar) => (
          <article
            key={pillar.title}
            className="group bg-bg-card p-7 transition-colors duration-300 hover:bg-bg-card-2"
          >
            <div className="flex items-start justify-between gap-3">
              <div
                className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-bg text-text transition-transform duration-300 group-hover:-translate-y-0.5"
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
    </section>
  );
}
