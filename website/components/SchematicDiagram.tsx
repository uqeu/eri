"use client";

import { useReveal } from "./useReveal";

// A self-drawing schematic in the spirit of the architecture reports: one eri
// brain at the centre, the same intelligence reaching every surface. Lines draw
// themselves (stroke-dashoffset) when the figure scrolls into view.

type Node = {
  readonly x: number;
  readonly y: number;
  readonly label: string;
  readonly sub: string;
};

const NODES: ReadonlyArray<Node> = [
  { x: 150, y: 90, label: "Your Mac", sub: "screen · apps · files" },
  { x: 590, y: 90, label: "Your phone", sub: "on the go" },
  { x: 370, y: 320, label: "You", sub: "voice · gaze · memory" },
];

const CENTER = { x: 370, y: 190 } as const;

function dist(n: Node): number {
  return Math.hypot(n.x - CENTER.x, n.y - CENTER.y) + 40;
}

export function SchematicDiagram(): React.ReactElement {
  const [ref, shown] = useReveal<HTMLDivElement>();
  return (
    <section className="relative border-t border-border py-24 lg:py-32">
      <div className="container">
        <header className="mb-12 max-w-2xl">
          <p className="mono-cap text-text-ter mb-5">One brain, every surface</p>
          <h2 className="font-serif text-balance text-[2.4rem] leading-[1.06] tracking-[-0.01em] text-text lg:text-[3rem]">
            The same eri, wherever you are.
          </h2>
          <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-text-sec">
            One private memory and one intelligence, synced across your computer
            and your phone. It learns you in one place and shows up everywhere —
            adapting to how <em>you</em> work.
          </p>
        </header>

        <div ref={ref} className="overflow-hidden rounded-2xl border border-border bg-bg-card p-6 sm:p-10">
          <svg
            viewBox="0 0 740 400"
            className="mx-auto h-auto w-full max-w-3xl"
            role="img"
            aria-label="One eri brain connected to your Mac, your phone, and you."
          >
            {/* connectors (draw on reveal) */}
            {NODES.map((n) => (
              <line
                key={n.label}
                x1={CENTER.x}
                y1={CENTER.y}
                x2={n.x}
                y2={n.y}
                className={`schematic-line${shown ? " draw" : ""}`}
                style={{ "--len": `${Math.round(dist(n))}` } as React.CSSProperties}
                stroke="rgba(15,23,42,0.28)"
                strokeWidth={1.5}
                strokeDasharray="5 4"
              />
            ))}

            {/* surface nodes */}
            {NODES.map((n, i) => (
              <g
                key={n.label}
                style={{
                  opacity: shown ? 1 : 0,
                  transition: "opacity 500ms var(--ease-out)",
                  transitionDelay: `${600 + i * 120}ms`,
                }}
              >
                <circle cx={n.x} cy={n.y} r={5} fill="var(--accent-emerald)" />
                <text
                  x={n.x}
                  y={n.y - 16}
                  textAnchor="middle"
                  className="font-sans"
                  fontSize="15"
                  fontWeight={500}
                  fill="var(--text)"
                >
                  {n.label}
                </text>
                <text
                  x={n.x}
                  y={n.y + 22}
                  textAnchor="middle"
                  className="font-mono"
                  fontSize="10.5"
                  letterSpacing="0.04em"
                  fill="var(--text-ter)"
                >
                  {n.sub}
                </text>
              </g>
            ))}

            {/* the brain at the centre */}
            <g>
              <rect
                x={CENTER.x - 64}
                y={CENTER.y - 32}
                width={128}
                height={64}
                rx={14}
                fill="#0f172a"
              />
              <text
                x={CENTER.x}
                y={CENTER.y - 2}
                textAnchor="middle"
                className="font-serif"
                fontSize="26"
                fill="#ffffff"
                style={{ letterSpacing: "-0.04em" }}
              >
                eri
              </text>
              <text
                x={CENTER.x}
                y={CENTER.y + 18}
                textAnchor="middle"
                className="font-mono"
                fontSize="9"
                letterSpacing="0.18em"
                fill="rgba(255,255,255,0.55)"
              >
                ONE BRAIN
              </text>
            </g>
          </svg>
        </div>
      </div>
    </section>
  );
}
