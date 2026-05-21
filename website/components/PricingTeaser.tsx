import Link from "next/link";

interface Tier {
  readonly name: string;
  readonly price: string;
  readonly tagline: string;
  readonly highlight?: boolean;
}

const TIERS: ReadonlyArray<Tier> = [
  {
    name: "Free",
    price: "$0",
    tagline: "Stock eri voice on us, diffusion edits, no keys to bring.",
  },
  {
    name: "Adaptive Eri",
    price: "$15",
    tagline: "Cross-session memory, premium voice presets, eri-cloud credits.",
  },
  {
    name: "Frontier Eri",
    price: "$25",
    tagline: "Multi-model routing, cloud agents, custom MCP servers.",
    highlight: true,
  },
];

export function PricingTeaser(): React.ReactElement {
  return (
    <section className="relative border-t border-white/[0.06]">
      <div className="mx-auto max-w-7xl px-6 py-24 sm:py-32">
        <div className="flex items-end justify-between gap-6 flex-wrap">
          <div className="max-w-xl">
            <p className="mono-cap text-accent">Pricing</p>
            <h2 className="mt-4 font-display text-h1 text-balance font-normal">
              Start free. Grow when you ship.
            </h2>
          </div>
          <Link
            href="/pricing"
            className="text-[13px] text-paper/60 hover:text-paper inline-flex items-center gap-1.5"
          >
            See all plans
            <span aria-hidden>→</span>
          </Link>
        </div>

        <div className="mt-12 grid gap-4 sm:grid-cols-3">
          {TIERS.map((tier) => (
            <article
              key={tier.name}
              className={
                "rounded-xl border p-7 " +
                (tier.highlight
                  ? "border-accent/40 bg-accent/[0.04]"
                  : "border-white/[0.06] bg-bg-2 card-lift")
              }
            >
              <div className="flex items-center justify-between">
                <p className="mono-cap text-paper/50">{tier.name}</p>
                {tier.highlight && (
                  <span className="mono-cap text-accent">Most picked</span>
                )}
              </div>
              <p className="mt-5 font-display text-4xl text-paper font-normal">
                {tier.price}
                <span className="text-paper/40 text-base font-mono ml-1">
                  /mo
                </span>
              </p>
              <p className="mt-4 text-[13px] text-paper/60 leading-relaxed">
                {tier.tagline}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
