"use client";

// Bento-style multi-model matrix. Each card has a model, a tagline written
// for eri's product context, a status pill, and a "default" selector dot.
// One model is the active default at a time and it rotates on a slow tick
// so the surface feels like a routing decision, not a static logo wall.

import { useEffect, useState } from "react";

type CardState =
  | "routing"
  | "warm"
  | "queued"
  | "cold-start"
  | "byok-ready";

interface ModelCard {
  readonly key: string;
  readonly name: string;
  readonly vendor: string;
  readonly vendorTag: string;
  readonly role: string;
  readonly tagline: string;
  readonly stat: string;
  readonly statLabel: string;
  readonly note: string;
  readonly state: CardState;
}

const MODELS: ReadonlyArray<ModelCard> = [
  {
    key: "eri-engine",
    name: "eri Engine",
    vendor: "eri",
    vendorTag: "// in-house · diffusion",
    role: "diffusion edits",
    tagline:
      "The whole diff at once. The eri Engine denoises a multi-file change in the time a tokenizer would still be warming up.",
    stat: "1.8s",
    statLabel: "median edit",
    note: "default for in-editor turns",
    state: "warm",
  },
  {
    key: "opus-47",
    name: "Claude Opus 4.7",
    vendor: "Anthropic",
    vendorTag: "// anthropic · 1M ctx",
    role: "deep reasoning",
    tagline:
      "Ask it to read the whole repo and propose the refactor that nobody dares to write. Opus is eri's slow lane when correctness matters more than speed.",
    stat: "1M",
    statLabel: "context window",
    note: "default for architecture turns",
    state: "warm",
  },
  {
    key: "sonnet-46",
    name: "Claude Sonnet 4.6",
    vendor: "Anthropic",
    vendorTag: "// anthropic · polish",
    role: "polish lane",
    tagline:
      "Catch the lint, fix the imports, write the commit message. Sonnet runs alongside the eri Engine so the diff lands clean without a second prompt.",
    stat: "≤ 4s",
    statLabel: "polish pass",
    note: "default for cleanup turns",
    state: "queued",
  },
  {
    key: "gpt-5",
    name: "GPT-5",
    vendor: "OpenAI",
    vendorTag: "// openai · planner",
    role: "long-form planning",
    tagline:
      "When the request is a whole document — a spec, a migration plan, a long test suite — GPT-5 plans it out and eri executes the parts.",
    stat: "200k",
    statLabel: "planning window",
    note: "default for planning turns",
    state: "byok-ready",
  },
  {
    key: "gemini-25-pro",
    name: "Gemini 2.5 Pro",
    vendor: "Google",
    vendorTag: "// google · vision-in",
    role: "multimodal",
    tagline:
      "Show it the Figma, the screenshot, the design doc. Gemini reads the picture and eri writes the component to match.",
    stat: "image-in",
    statLabel: "modality",
    note: "default for visual turns",
    state: "cold-start",
  },
];

const ROUTE_TICK_MS = 2_400;

export function ModelMatrix(): React.ReactElement {
  const [activeIdx, setActiveIdx] = useState<number>(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setActiveIdx((i) => (i + 1) % MODELS.length);
    }, ROUTE_TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  return (
    <section
      id="models"
      className="relative border-t border-white/[0.08] bg-bg-1"
    >
      <div className="mx-auto max-w-7xl px-6 py-24 sm:py-32">
        <div className="flex items-end justify-between gap-8 flex-wrap">
          <div className="max-w-3xl">
            <p className="mono-cap text-accent">Model routing</p>
            <h2 className="mt-5 font-display text-h2 text-balance font-normal leading-[1.02]">
              Five frontier models.{" "}
              <span className="italic accent-shimmer">
                Pick one with your voice.
              </span>
            </h2>
            <p className="mt-5 max-w-xl text-paper/60 text-[15px] leading-relaxed">
              Eri ships with a small router that knows the strengths of every
              model and a manual override that fits in a single spoken phrase.
              Bring your own keys for every provider — eri never proxies the
              call.
            </p>
            <p className="mt-3 max-w-xl text-paper/40 text-[12px] leading-relaxed">
              eri uses multiple frontier models behind the eri Engine API.
            </p>
          </div>
          <RouteBadge model={MODELS[activeIdx]!} />
        </div>

        <div className="mt-14 grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-6">
          {MODELS.map((model, i) => (
            <ModelCardView
              key={model.key}
              model={model}
              active={i === activeIdx}
              size={i === 0 ? "wide" : "regular"}
            />
          ))}
        </div>

        <RoutingFootnote />
      </div>
    </section>
  );
}

function RouteBadge({ model }: { readonly model: ModelCard }): React.ReactElement {
  return (
    <div className="rounded-md border border-white/[0.08] bg-bg-3 px-4 py-3 max-w-[280px]">
      <p className="mono-cap text-paper/40">routing now</p>
      <p className="mt-1.5 font-mono text-[13px] text-paper flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-accent pulse-dot" />
        {model.name}
      </p>
      <p className="mt-0.5 mono-cap text-paper/40 text-[10px]">{model.note}</p>
    </div>
  );
}

interface ModelCardProps {
  readonly model: ModelCard;
  readonly active: boolean;
  readonly size: "wide" | "regular";
}

function ModelCardView({
  model,
  active,
  size,
}: ModelCardProps): React.ReactElement {
  const span = size === "wide" ? "lg:col-span-6" : "lg:col-span-3";
  const ring = active
    ? "border-accent/40 bg-accent/[0.04]"
    : "border-white/[0.08] bg-white/[0.02]";
  return (
    <article
      className={
        "group relative overflow-hidden rounded-xl border transition-all duration-500 card-lift p-7 sm:p-8 " +
        ring +
        " " +
        span
      }
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] text-paper/35 tracking-tight">
            {model.vendorTag}
          </p>
          <h3 className="mt-2.5 font-display text-3xl sm:text-4xl text-paper font-normal leading-none">
            {model.name}
          </h3>
          <p className="mt-2 mono-cap text-accent">{model.role}</p>
        </div>
        <StatusPill active={active} state={model.state} />
      </div>

      <p
        className={
          "mt-6 text-[14px] leading-relaxed " +
          (size === "wide" ? "max-w-2xl text-paper/70" : "text-paper/60")
        }
      >
        {model.tagline}
      </p>

      <div className="mt-7 flex items-end justify-between gap-4 pt-5 border-t border-white/[0.06]">
        <div>
          <p className="mono-cap text-paper/40 text-[9px]">{model.statLabel}</p>
          <p className="mt-1 font-display text-2xl text-paper font-normal leading-none tabular-nums">
            {model.stat}
          </p>
        </div>
        <DefaultMarker active={active} state={model.state} />
      </div>

      <div
        className="absolute inset-x-0 bottom-0 h-px bg-accent transition-all duration-500"
        style={{ width: active ? "100%" : "0%" }}
        aria-hidden
      />
    </article>
  );
}

const STATE_LABEL: Readonly<Record<CardState, string>> = {
  routing: "routing now",
  warm: "warm pool",
  queued: "queued · polish",
  "cold-start": "cold start ~600ms",
  "byok-ready": "byok ready",
};

interface StatusPillProps {
  readonly active: boolean;
  readonly state: CardState;
}

function StatusPill({ active, state }: StatusPillProps): React.ReactElement {
  const label = active ? STATE_LABEL.routing : STATE_LABEL[state];
  return (
    <span
      className={
        "inline-flex items-center gap-1.5 shrink-0 px-2 py-0.5 rounded-sm border font-mono text-[10px] uppercase tracking-wider " +
        (active
          ? "border-accent/40 bg-accent/10 text-accent"
          : "border-white/[0.08] bg-bg-3 text-paper/50")
      }
    >
      <span
        className={
          "h-1.5 w-1.5 rounded-full " +
          (active ? "bg-accent pulse-dot" : "bg-white/15")
        }
      />
      {label}
    </span>
  );
}

const DEFAULT_LABEL: Readonly<Record<CardState, string>> = {
  routing: "active",
  warm: "bind to ⌘1",
  queued: "queued",
  "cold-start": "load on demand",
  "byok-ready": "needs key",
};

interface DefaultMarkerProps {
  readonly active: boolean;
  readonly state: CardState;
}

function DefaultMarker({
  active,
  state,
}: DefaultMarkerProps): React.ReactElement {
  const label = active ? "default" : DEFAULT_LABEL[state];
  return (
    <div className="flex items-center gap-2">
      <span
        className={
          "inline-flex items-center justify-center h-4 w-4 rounded-full border-2 " +
          (active ? "border-accent" : "border-white/15")
        }
      >
        {active && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
      </span>
      <span
        className={
          "mono-cap text-[10px] " + (active ? "text-accent" : "text-paper/40")
        }
      >
        {label}
      </span>
    </div>
  );
}

interface FootnoteCardProps {
  readonly kicker: string;
  readonly body: React.ReactNode;
}

const FOOTNOTES: ReadonlyArray<FootnoteCardProps> = [
  {
    kicker: "BYOK",
    body: (
      <>
        Your keys, your billing. Eri binds each provider to a Keychain Access
        entry scoped to the editor process — the renderer never reads the
        secret, the sidecar signs requests in a sandboxed worker.
      </>
    ),
  },
  {
    kicker: "Voice override",
    body: (
      <>
        Say <span className="text-paper/90">&ldquo;use Opus for this
        one&rdquo;</span> mid-turn. A local whisper.cpp pass spots the hot
        keyword <span className="font-mono text-paper/75">use&nbsp;X</span>{" "}
        before the sentence finishes; the next turn falls back to your default.
      </>
    ),
  },
  {
    kicker: "Local fallback",
    body: (
      <>
        Lose the network and eri swaps the route to a 4-bit Llama-3.2-3B
        running on the same machine. The diff queues against the cloud lane and
        replays the moment your uplink returns — the loop never stops.
      </>
    ),
  },
];

function RoutingFootnote(): React.ReactElement {
  return (
    <div className="mt-10 grid gap-3 md:grid-cols-3">
      {FOOTNOTES.map((f) => (
        <div
          key={f.kicker}
          className="rounded-lg border border-white/[0.06] bg-bg-3/50 p-5"
        >
          <p className="mono-cap text-accent">{f.kicker}</p>
          <p className="mt-2.5 text-[13px] text-paper/65 leading-relaxed">
            {f.body}
          </p>
        </div>
      ))}
    </div>
  );
}
