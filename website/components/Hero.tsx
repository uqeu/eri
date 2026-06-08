import Link from "next/link";
import { DemoPlayer } from "./DemoPlayer";

const PROOF: ReadonlyArray<{ k: string; v: string }> = [
  { k: "On-device", v: "voice · eyes · memory" },
  { k: "Asks first", v: "before anything risky" },
  { k: "macOS", v: "Windows & Linux soon" },
];

export function Hero(): React.ReactElement {
  return (
    <section className="relative overflow-hidden bg-bg text-text">
      {/* Layered depth: neutral wash + lime-faint mesh + film grain. */}
      <div className="pointer-events-none absolute inset-0 hero-wash" />
      <div className="pointer-events-none absolute inset-0 mesh-bg opacity-70" />
      <div className="pointer-events-none absolute inset-0 grain opacity-[0.5] mix-blend-soft-light" />

      <div className="container relative pt-28 pb-20 lg:pt-36 lg:pb-28">
        <div className="grid items-center gap-14 lg:grid-cols-[1.05fr_1fr] lg:gap-10">
          {/* Left: the pitch */}
          <div className="max-w-xl">
            <p
              className="rise mono-cap text-text-ter mb-6"
              style={{ animationDelay: "0ms" }}
            >
              Hands-free computer control
            </p>

            <h1
              className="rise text-display font-display text-balance mb-6"
              style={{ animationDelay: "60ms", fontWeight: 500 }}
            >
              Your computer,
              <br />
              hands-free.
            </h1>

            <p
              className="rise text-text-sec text-[18px] leading-[1.55] text-prose-narrow mb-9"
              style={{ animationDelay: "140ms" }}
            >
              eri sees your screen, hears you, and remembers you — then does the
              work. Voice and eyes in, action out. A coding agent and a
              computer-use agent in one, learning how you work. Local-first by
              design.
            </p>

            <div
              className="rise flex flex-wrap items-center gap-3"
              style={{ animationDelay: "220ms" }}
            >
              <Link
                href="/download"
                className="group inline-flex items-center gap-2 rounded-md bg-text px-5 py-2.5 text-[14px] font-medium text-bg transition-transform duration-200 ease-out-soft hover:-translate-y-0.5 active:translate-y-0"
              >
                Download eri
                <span
                  aria-hidden
                  className="transition-transform duration-200 group-hover:translate-x-0.5"
                >
                  →
                </span>
              </Link>
              <Link
                href="/docs"
                className="inline-flex items-center rounded-md border border-border px-5 py-2.5 text-[14px] text-text transition-colors duration-200 hover:border-border-strong hover:bg-bg-card"
              >
                See how it works
              </Link>
            </div>

            {/* Honest proof — capabilities, not invented metrics. */}
            <dl
              className="rise mt-12 grid max-w-md grid-cols-3 gap-px overflow-hidden rounded-lg border border-border bg-border"
              style={{ animationDelay: "300ms" }}
            >
              {PROOF.map((p) => (
                <div key={p.k} className="bg-bg px-4 py-3">
                  <dt className="font-display text-[15px] text-text">{p.k}</dt>
                  <dd className="mt-0.5 text-[11px] leading-tight text-text-ter">
                    {p.v}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Right: the signature motion demo (Remotion) */}
          <div
            className="rise lg:translate-x-2"
            style={{ animationDelay: "180ms" }}
          >
            <DemoPlayer />
          </div>
        </div>
      </div>
    </section>
  );
}
