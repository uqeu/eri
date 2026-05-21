interface Testimonial {
  readonly quote: string;
  readonly name: string;
  readonly role: string;
  readonly company: string;
  readonly initials: string;
  readonly avatarFrom: string;
  readonly avatarTo: string;
  readonly accent?: boolean;
  readonly size?: "default" | "wide" | "tall";
}

const TESTIMONIALS: ReadonlyArray<Testimonial> = [
  {
    quote:
      "First hour with eri, I caught myself talking to the editor like a pair. By hour three I'd shipped a webhook handler I'd been putting off for weeks.",
    name: "S.K.",
    role: "Founding engineer",
    company: "Solo studio · SF",
    initials: "SK",
    avatarFrom: "#228df2",
    avatarTo: "#0f4ea0",
    size: "wide",
    accent: true,
  },
  {
    quote:
      "Eri's engine is the first diffusion engine that actually feels like it edits the file instead of regenerating it. The diffs are surgical.",
    name: "M.R.",
    role: "Staff engineer",
    company: "Stealth fintech",
    initials: "MR",
    avatarFrom: "#e0ff4f",
    avatarTo: "#9bb52b",
  },
  {
    quote:
      "I dictated a refactor across six files while making coffee. Came back, reviewed the diff, accepted four, kept thinking. This is the loop.",
    name: "J.A.",
    role: "Indie hacker",
    company: "Side projects · NYC",
    initials: "JA",
    avatarFrom: "#f08a4b",
    avatarTo: "#a04f1e",
  },
  {
    quote:
      "It's quiet in a way Copilot never was. eri waits until I finish a thought, then it moves fast — like having a senior pair who actually shuts up.",
    name: "T.O.",
    role: "Senior dev",
    company: "Series B SaaS",
    initials: "TO",
    avatarFrom: "#b07cff",
    avatarTo: "#5f3fa8",
    size: "tall",
  },
  {
    quote:
      "The gaze targeting was the part I was skeptical about. Two days in I realized I'd stopped reaching for the trackpad to point at things.",
    name: "C.L.",
    role: "Design engineer",
    company: "Boutique agency · London",
    initials: "CL",
    avatarFrom: "#41d57c",
    avatarTo: "#1a7d44",
  },
  {
    quote:
      "Cursor-familiar shortcuts, voice on top, diffusion under the hood. Took twenty minutes to feel native. Now my keyboard is mostly for hotkeys.",
    name: "A.D.",
    role: "Tech lead",
    company: "Mid-stage startup",
    initials: "AD",
    avatarFrom: "#ff6b9d",
    avatarTo: "#9c3d63",
  },
  {
    quote:
      "Voice-first sounds gimmicky until you've done a four-hour session without RSI flaring. That alone made the switch worth it for me.",
    name: "R.V.",
    role: "Full-stack dev",
    company: "Remote · Lisbon",
    initials: "RV",
    avatarFrom: "#5fc7d8",
    avatarTo: "#27707e",
    size: "wide",
  },
  {
    quote:
      "I write CLI tools mostly. eri's diff preview is the first AI surface that doesn't make me anxious about accepting changes.",
    name: "P.B.",
    role: "Platform engineer",
    company: "Infra collective",
    initials: "PB",
    avatarFrom: "#e0ff4f",
    avatarTo: "#9bb52b",
  },
  {
    quote:
      "Speak the rough idea, glance at the diff, keep going. The thought-to-merged-code latency is the lowest I've ever felt.",
    name: "K.M.",
    role: "CTO",
    company: "Two-person company",
    initials: "KM",
    avatarFrom: "#228df2",
    avatarTo: "#0f4ea0",
    accent: true,
  },
];

interface TestimonialCardProps {
  readonly item: Testimonial;
}

function TestimonialCard({ item }: TestimonialCardProps): React.ReactElement {
  const spanClass =
    item.size === "wide"
      ? "md:col-span-2"
      : item.size === "tall"
        ? "md:row-span-2"
        : "";

  return (
    <figure
      className={`group relative flex h-full flex-col rounded-xl border border-white/[0.08] bg-white/[0.02] p-7 card-lift ${spanClass}`}
    >
      {item.accent ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-xl bg-gradient-to-br from-accent/[0.06] via-transparent to-transparent"
        />
      ) : null}
      <div className="relative flex h-full flex-col">
        <span
          aria-hidden
          className="font-display text-5xl leading-none text-accent/70"
        >
          &ldquo;
        </span>
        <blockquote className="mt-3 flex-1 text-balance text-[15px] leading-relaxed text-paper/90">
          {item.quote}
        </blockquote>
        <figcaption className="mt-7 flex items-center gap-3 border-t border-white/[0.06] pt-5">
          <span
            aria-hidden
            className="inline-flex h-9 w-9 items-center justify-center rounded-full font-mono text-[11px] font-medium text-ink"
            style={{
              background: `linear-gradient(135deg, ${item.avatarFrom}, ${item.avatarTo})`,
            }}
          >
            {item.initials}
          </span>
          <span className="flex flex-col leading-tight">
            <span className="text-[13px] text-paper">
              {item.name} · {item.role}
            </span>
            <span className="font-mono text-[11px] uppercase tracking-wider text-paper/45">
              {item.company}
            </span>
          </span>
        </figcaption>
      </div>
    </figure>
  );
}

export function Testimonials(): React.ReactElement {
  return (
    <section className="relative border-t border-white/[0.08]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/20 to-transparent"
      />
      <div className="mx-auto max-w-7xl px-6 py-24 sm:py-32">
        <div className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl">
            <p className="mono-cap text-accent/80">Field reports · v0.4 alpha</p>
            <h2 className="mt-5 font-display text-h2 font-normal text-balance">
              The first build that{" "}
              <span className="italic accent-shimmer">disappears</span> into the
              work.
            </h2>
            <p className="mt-5 max-w-xl text-[14px] leading-relaxed text-paper/55">
              Notes from the alpha. Names trimmed to initials at the writers&apos;
              request — we&apos;ll loosen up once we&apos;re out of invite-only.
            </p>
          </div>
          <div className="flex items-center gap-6 font-mono text-[11px] uppercase tracking-wider text-paper/50">
            <span className="inline-flex items-center gap-2">
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_rgba(224,255,79,0.7)]"
              />
              412 alpha builders
            </span>
            <span className="hidden h-5 w-px bg-white/10 sm:inline-block" />
            <span className="hidden sm:inline">avg session · 2h 47m</span>
          </div>
        </div>

        <div className="mt-14 grid auto-rows-fr gap-4 md:grid-cols-3 md:grid-flow-row-dense">
          {TESTIMONIALS.map((item) => (
            <TestimonialCard key={item.name + item.quote.slice(0, 12)} item={item} />
          ))}
        </div>
      </div>
    </section>
  );
}
