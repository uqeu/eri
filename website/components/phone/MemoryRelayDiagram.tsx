interface NodeSpec {
  readonly id: string;
  readonly kicker: string;
  readonly title: string;
  readonly lines: ReadonlyArray<string>;
}

const NODES: ReadonlyArray<NodeSpec> = [
  {
    id: "phone",
    kicker: "Surface",
    title: "Your phone",
    lines: ["A text thread.", "No app to install."],
  },
  {
    id: "cloud",
    kicker: "Cloud half",
    title: "Phone eri",
    lines: ["Reads Tier-A profile.", "Relays the rest."],
  },
  {
    id: "computer",
    kicker: "Your computer",
    title: "Resident eri",
    lines: ["Holds Tier-B memory.", "Runs goals here."],
  },
];

interface TierSpec {
  readonly id: string;
  readonly label: string;
  readonly title: string;
  readonly body: string;
  readonly readable: string;
}

const TIERS: ReadonlyArray<TierSpec> = [
  {
    id: "a",
    label: "Tier A",
    title: "Personalization profile",
    body: "A small, server-readable sketch of how you sound and what you care about — enough for phone eri to answer like you.",
    readable: "Server-readable",
  },
  {
    id: "b",
    label: "Tier B",
    title: "Encrypted memory blob",
    body: "Your full history — bi-temporal, private, end-to-end encrypted. Only your computer holds the key. Deep questions relay home to be answered.",
    readable: "Only your computer reads it",
  },
];

/**
 * Hand-built editorial schematic of the two-tier memory + relay path:
 * phone -> cloud (Tier-A readable) -> your computer (Tier-B E2E only).
 * No chart library — SVG connectors + divs in the site's restrained style.
 */
export function MemoryRelayDiagram(): React.ReactElement {
  return (
    <figure className="m-0">
      <div className="rounded-xl border border-border bg-bg-card/40 p-6 sm:p-10">
        {/* Three-node spine */}
        <div
          className="relative grid gap-6 md:grid-cols-3 md:gap-0"
          role="img"
          aria-label="Diagram: your phone connects to the cloud half of eri, which relays deep questions and actions to the eri resident on your computer. Tier-A personalization data is server-readable; Tier-B memory is end-to-end encrypted and readable only by your computer."
        >
          {NODES.map((node, i) => (
            <div key={node.id} className="relative md:px-5">
              <div className="h-full rounded-lg border border-border bg-bg-card p-5">
                <span className="mono-cap text-text-ter">{node.kicker}</span>
                <div
                  className="mt-2 font-display text-text"
                  style={{ fontSize: "1.4rem", fontWeight: 500, letterSpacing: "-0.02em" }}
                >
                  {node.title}
                </div>
                <div className="mt-3 space-y-1">
                  {node.lines.map((line) => (
                    <p key={line} className="text-[13.5px] leading-snug text-text-sec">
                      {line}
                    </p>
                  ))}
                </div>
              </div>

              {/* Connector to next node (desktop: horizontal, mobile: vertical) */}
              {i < NODES.length - 1 ? (
                <>
                  <div
                    aria-hidden
                    className="hidden md:flex absolute top-1/2 -right-px z-10 -translate-y-1/2 translate-x-1/2 items-center"
                  >
                    <span className="block h-px w-10 bg-gradient-to-r from-border via-accent/50 to-border" />
                    <span className="text-accent text-xs">→</span>
                  </div>
                  <div
                    aria-hidden
                    className="md:hidden mx-auto my-1 flex h-6 w-px items-center justify-center bg-gradient-to-b from-border via-accent/50 to-border"
                  />
                </>
              ) : null}
            </div>
          ))}
        </div>

        {/* Relay caption */}
        <p className="mt-6 text-center text-[12.5px] text-text-ter">
          Sounds-like-you answers stay in the cloud.{" "}
          <span className="text-text-sec">
            Deep or private questions — and any action on your machine — relay home.
          </span>
        </p>

        {/* Two-tier memory legend */}
        <div className="mt-8 grid gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-2">
          {TIERS.map((tier) => (
            <div key={tier.id} className="bg-bg-card p-5">
              <div className="flex items-center justify-between">
                <span className="mono-cap text-accent">{tier.label}</span>
                <span className="font-geist text-[12px] text-text-ter">
                  {tier.readable}
                </span>
              </div>
              <div
                className="mt-2.5 font-display text-text"
                style={{ fontSize: "1.15rem", fontWeight: 500, letterSpacing: "-0.015em" }}
              >
                {tier.title}
              </div>
              <p className="mt-2 text-[13.5px] leading-relaxed text-text-sec">{tier.body}</p>
            </div>
          ))}
        </div>
      </div>
      <figcaption className="mt-3 text-center text-[12px] text-text-ter">
        Two tiers of memory, one relay path. Tier B never leaves your computer in the clear.
      </figcaption>
    </figure>
  );
}
