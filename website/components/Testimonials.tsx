interface Quote {
  readonly quote: string;
  readonly name: string;
  readonly role: string;
  readonly company: string;
}

const QUOTES: ReadonlyArray<Quote> = [
  {
    quote:
      "I dictated a refactor across six files while making coffee. Came back, reviewed the diff, accepted four, kept thinking. This is the loop.",
    name: "J.A.",
    role: "Indie hacker",
    company: "Side projects · NYC",
  },
  {
    quote:
      "It's quiet in a way Copilot never was. eri waits until I finish a thought, then moves fast — like having a senior pair who actually shuts up.",
    name: "T.O.",
    role: "Senior dev",
    company: "Series B SaaS",
  },
  {
    quote:
      "The gaze targeting was the part I was skeptical about. Two days in I realized I'd stopped reaching for the trackpad to point at things.",
    name: "C.L.",
    role: "Design engineer",
    company: "Boutique agency · London",
  },
];

export function Testimonials(): React.ReactElement {
  return (
    <section className="container py-24 lg:py-32">
      <div className="border-t border-border pt-10 mb-16">
        <div className="mono-cap text-text-sec mb-3">VI · What people say</div>
        <h2 className="text-h2 text-balance max-w-2xl text-text">
          From the first wave of invites.
        </h2>
      </div>

      <div className="divide-y divide-border">
        {QUOTES.map((q) => (
          <figure
            key={q.name + q.quote.slice(0, 16)}
            className="py-12 lg:py-16 grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-12"
          >
            <blockquote className="lg:col-span-9 font-display text-[clamp(1.5rem,2.6vw,2rem)] leading-[1.25] text-balance italic text-text">
              &ldquo;{q.quote}&rdquo;
            </blockquote>
            <figcaption className="lg:col-span-3 flex flex-col justify-end font-mono text-[11px] uppercase tracking-[0.18em] text-text-sec">
              <span className="text-text">{q.name}</span>
              <span className="mt-1">{q.role}</span>
              <span className="mt-1 normal-case tracking-normal italic text-text-ter">
                {q.company}
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
