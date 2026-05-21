import Link from "next/link";
import { SiteHeader } from "./SiteHeader";

interface MarqueeItem {
  readonly label: string;
}

const PARITY_MARQUEE: ReadonlyArray<MarqueeItem> = [
  { label: "Tab completion" },
  { label: "Cmd-K inline edit" },
  { label: "Composer" },
  { label: "Agent mode" },
  { label: "@-mentions" },
  { label: "Codebase indexing" },
  { label: "MCP" },
  { label: "Multi-model routing" },
  { label: "Bug Finder" },
  { label: "Cloud Agents" },
  { label: "Apply diffs" },
  { label: "Terminal AI" },
];

interface PillarItem {
  readonly tag: string;
  readonly title: string;
  readonly body: string;
}

const PILLARS: ReadonlyArray<PillarItem> = [
  {
    tag: "Voice",
    title: "Build at the speed of speech",
    body: "A local Whisper sidecar transcribes you in the same room your code lives in. No round-trip, no consent screens, no waiting.",
  },
  {
    tag: "Diffusion",
    title: "See the diff before it's written",
    body: "The eri Engine denoises a working patch while you finish your sentence. Watch the preview resolve instead of staring at a streaming cursor.",
  },
  {
    tag: "Gaze",
    title: "Look at what you mean",
    body: "An optional eye tracker tells eri where on screen you're pointing. “move that button up” stops being a guessing game.",
  },
];

export function Hero(): React.ReactElement {
  return (
    <section className="relative overflow-hidden">
      <div
        className="absolute inset-0 pointer-events-none mesh-bg opacity-70"
        aria-hidden
      />
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.06] grain mix-blend-overlay"
        aria-hidden
      />
      <div
        className="absolute inset-x-0 top-0 h-[70vh] pointer-events-none check-grid opacity-[0.4]"
        aria-hidden
        style={{
          maskImage:
            "radial-gradient(55% 50% at 50% 0%, black 0%, transparent 80%)",
          WebkitMaskImage:
            "radial-gradient(55% 50% at 50% 0%, black 0%, transparent 80%)",
        }}
      />
      <div
        className="absolute left-1/2 top-[-20%] -translate-x-1/2 w-[1400px] h-[700px] pointer-events-none"
        aria-hidden
        style={{
          background:
            "radial-gradient(closest-side, rgba(224,255,79,0.10), transparent 70%)",
          filter: "blur(40px)",
        }}
      />

      <SiteHeader />

      <div className="relative mx-auto max-w-7xl px-6 pt-20 pb-20 sm:pt-28 sm:pb-28">
        <div
          className="flex flex-col items-center text-center animate-fade-up"
          style={{ animationDelay: "0.05s", opacity: 0 }}
        >
          <p className="inline-flex items-center gap-2.5 mono-cap text-accent">
            <span className="relative inline-flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-accent opacity-60 animate-ping" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
            </span>
            Now in private beta · macOS
          </p>
        </div>

        <h1
          className="mt-8 mx-auto max-w-5xl text-center font-display text-balance animate-fade-up"
          style={{
            animationDelay: "0.15s",
            opacity: 0,
            fontWeight: 400,
            fontSize: "clamp(2.5rem, 8vw, 6.5rem)",
            lineHeight: 0.95,
            letterSpacing: "-0.04em",
          }}
        >
          The IDE that builds
          <br />
          while you{" "}
          <span className="italic font-normal accent-shimmer">talk.</span>
        </h1>

        <p
          className="mt-8 mx-auto max-w-2xl text-center text-body text-paper/65 animate-fade-up"
          style={{ animationDelay: "0.25s", opacity: 0 }}
        >
          A voice-driven, diffusion-native editor that reads the room — knows
          what you mean, anticipates the next change, and resolves the diff
          while you finish the sentence. No friction between intent and code.
        </p>

        <div
          className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3 animate-fade-up"
          style={{ animationDelay: "0.35s", opacity: 0 }}
        >
          <Link
            href="/download"
            className="btn-primary inline-flex items-center justify-center gap-2 px-6 py-3.5 text-[15px]"
          >
            Download for macOS
            <span aria-hidden>↓</span>
          </Link>
          <Link
            href="#demo"
            className="btn-ghost inline-flex items-center justify-center gap-2 px-6 py-3.5 text-[15px]"
          >
            <span aria-hidden className="text-accent">▶</span>
            Watch demo
          </Link>
        </div>

        <p
          className="mt-5 text-center text-[12px] text-paper/40 font-mono animate-fade-up"
          style={{ animationDelay: "0.45s", opacity: 0 }}
        >
          Forked from VSCodium · Your keys · Your machine · Free in beta
        </p>

        <div
          className="mt-20 sm:mt-24 animate-fade-up"
          style={{ animationDelay: "0.55s", opacity: 0 }}
        >
          <ParityMarquee />
        </div>

        <div
          className="mt-24 sm:mt-28 animate-fade-up"
          style={{ animationDelay: "0.65s", opacity: 0 }}
        >
          <PillarGrid />
        </div>
      </div>
    </section>
  );
}

function ParityMarquee(): React.ReactElement {
  return (
    <div className="relative">
      <div className="flex items-center justify-center mb-6">
        <p className="mono-cap text-paper/35">
          Everything you expect from a modern AI IDE
        </p>
      </div>
      <div
        className="relative overflow-hidden"
        style={{
          maskImage:
            "linear-gradient(90deg, transparent 0%, black 12%, black 88%, transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(90deg, transparent 0%, black 12%, black 88%, transparent 100%)",
        }}
      >
        <div className="flex gap-3 marquee-track">
          {[...PARITY_MARQUEE, ...PARITY_MARQUEE].map((item, idx) => (
            <span
              key={`${item.label}-${idx}`}
              className="shrink-0 inline-flex items-center gap-2 px-3.5 py-1.5 rounded-sm border border-white/[0.06] bg-bg-2/60 text-[12px] font-mono text-paper/65 backdrop-blur-sm"
            >
              <span
                className="h-1 w-1 rounded-full bg-accent/70"
                aria-hidden
              />
              {item.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function PillarGrid(): React.ReactElement {
  return (
    <div>
      <div className="flex flex-col items-center text-center mb-12">
        <p className="mono-cap text-accent">What Cursor can't do</p>
        <h2
          className="mt-4 font-display text-h2 text-balance"
          style={{ fontWeight: 400 }}
        >
          Three differentiators baked into the editor.
        </h2>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {PILLARS.map((pillar) => (
          <article
            key={pillar.tag}
            className="card-lift rounded-lg border border-white/[0.06] bg-bg-2/70 p-7"
          >
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
              <p className="mono-cap text-paper/55">{pillar.tag}</p>
            </div>
            <h3
              className="mt-5 font-display text-2xl text-paper text-balance"
              style={{ fontWeight: 400, letterSpacing: "-0.02em" }}
            >
              {pillar.title}
            </h3>
            <p className="mt-3 text-[14px] leading-relaxed text-paper/55">
              {pillar.body}
            </p>
          </article>
        ))}
      </div>
    </div>
  );
}
