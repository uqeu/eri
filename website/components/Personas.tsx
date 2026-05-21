interface Persona {
  readonly glyph: string;
  readonly title: string;
  readonly body: string;
}

const PERSONAS: ReadonlyArray<Persona> = [
  {
    glyph: "◆",
    title: "Indie founders",
    body: "Ship the v1 before the coffee cools. Voice your idea, watch eri scaffold the routes, the auth, and the landing — then put it on Vercel without leaving the conversation.",
  },
  {
    glyph: "◇",
    title: "Solo SaaS",
    body: "Run your whole stack from one window. The eri Engine diffuses the small edits, Opus handles the long refactors, cloud agents grind the migrations while you sleep.",
  },
  {
    glyph: "◈",
    title: "Side-project builders",
    body: "Weekends are short. eri remembers your stack, your patterns, and your taste — so Sunday afternoon starts where Saturday morning left off.",
  },
];

export function Personas(): React.ReactElement {
  return (
    <section className="relative border-t border-white/[0.06]">
      <div className="mx-auto max-w-7xl px-6 py-24 sm:py-32">
        <div className="max-w-2xl">
          <p className="mono-cap text-accent">Who it&apos;s for</p>
          <h2 className="mt-4 font-display text-h1 text-balance font-normal">
            Built for builders of one.
          </h2>
        </div>

        <div className="mt-12 grid gap-4 sm:grid-cols-3">
          {PERSONAS.map((p) => (
            <article
              key={p.title}
              className="card-lift rounded-xl border border-white/[0.06] bg-bg-2 p-7"
            >
              <span
                aria-hidden
                className="font-display text-3xl text-accent"
              >
                {p.glyph}
              </span>
              <h3 className="mt-5 font-display text-h3 text-paper font-normal">
                {p.title}
              </h3>
              <p className="mt-3 text-body text-paper/60 leading-relaxed">
                {p.body}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
