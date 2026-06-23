import { Check, MousePointerClick, Plug, Code2, Globe, Loader2 } from "lucide-react";

// Capabilities shown as demonstrations, not a grid of identical feature cards.
// Four things eri does — control your apps, reach your services, build software,
// search the live web — each in its own live-looking panel, deliberately
// different in shape and content. Ambient CSS motion keeps them alive without a
// per-panel state machine; all of it degrades to a legible resting state.

export function Capabilities(): React.ReactElement {
  return (
    <section className="relative border-t border-border py-24 lg:py-32">
      <div className="container">
        <header className="mx-auto mb-14 max-w-2xl text-center">
          <h2 className="font-display text-balance text-[clamp(2rem,4.4vw,3.2rem)] font-600 leading-[1.04] tracking-[-0.03em] text-text">
            it doesn’t describe the work. it does it.
          </h2>
          <p className="mx-auto mt-5 max-w-lg text-pretty text-[16.5px] leading-relaxed text-text-sec">
            Four things eri does on your behalf, every day. Each one runs for
            real, not as a slide.
          </p>
        </header>

        <div className="mx-auto grid max-w-5xl gap-5 lg:grid-cols-12">
          <Panel
            className="lg:col-span-7"
            icon={<MousePointerClick size={15} strokeWidth={2} />}
            label="Control"
            claim="Runs your real apps, hands-free — clicks, types, and checks its own work."
          >
            <ControlDemo />
          </Panel>

          <Panel
            className="lg:col-span-5"
            icon={<Plug size={15} strokeWidth={2} />}
            label="Connectors"
            claim="Reaches 1,000+ of your services through one secure layer."
          >
            <ConnectorsDemo />
          </Panel>

          <Panel
            className="lg:col-span-5"
            icon={<Code2 size={15} strokeWidth={2} />}
            label="Build"
            claim="Plans, edits across files, runs the tests, and ships."
          >
            <BuildDemo />
          </Panel>

          <Panel
            className="lg:col-span-7"
            icon={<Globe size={15} strokeWidth={2} />}
            label="Web"
            claim="Searches the live web and answers with its sources, in-line."
          >
            <WebDemo />
          </Panel>
        </div>
      </div>
    </section>
  );
}

function Panel({
  className,
  icon,
  label,
  claim,
  children,
}: {
  readonly className?: string;
  readonly icon: React.ReactNode;
  readonly label: string;
  readonly claim: string;
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className={`glass-soft flex flex-col overflow-hidden rounded-2xl p-6 ${className ?? ""}`}>
      <div className="mb-1 flex items-center gap-2.5">
        <span className="flex size-7 items-center justify-center rounded-lg border border-border bg-bg-card-2 text-accent">
          {icon}
        </span>
        <span className="font-geist-mono text-[11px] uppercase tracking-[0.16em] text-text-ter">
          {label}
        </span>
      </div>
      <p className="mt-2 max-w-sm font-geist text-[15px] leading-snug text-text">{claim}</p>
      <div className="mt-6 flex-1">{children}</div>
    </div>
  );
}

// Control — a finished action trace with one step still resolving.
function ControlDemo(): React.ReactElement {
  const steps = [
    { t: "Opened Slack", done: true },
    { t: "Posted the standup to #team", done: true },
    { t: "DM’d Priya the blocker", done: true },
    { t: "Marking the ticket done", done: false },
  ];
  return (
    <div className="rounded-xl border border-border bg-bg-card-2/60 p-4 font-geist-mono">
      <div className="flex items-center gap-2 text-[12px]">
        <span className="text-text-ter">eri ›</span>
        <span className="text-text">post my standup and ping Priya</span>
      </div>
      <ol className="mt-3.5 space-y-2.5">
        {steps.map((s, i) => (
          <li key={s.t} className="flex items-center gap-2.5">
            {s.done ? (
              <span className="flex size-4 items-center justify-center rounded-full bg-accent">
                <Check size={10} strokeWidth={3} color="#14180a" />
              </span>
            ) : (
              <Loader2 size={14} strokeWidth={2.4} className="animate-spin text-accent" />
            )}
            <span className={`font-geist text-[13px] ${s.done ? "text-text-sec" : "text-text"}`}>
              {s.t}
            </span>
            {s.done && (
              <span
                className="ml-auto size-1 rounded-full bg-accent"
                style={{ animation: `pulseDot 1.6s ease-in-out ${i * 0.2}s infinite` }}
              />
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

// Connectors — two marquee rows of real services flowing in opposite directions.
const SERVICES_A = ["Gmail", "Calendar", "Slack", "Notion", "Linear", "GitHub", "Stripe", "Figma"];
const SERVICES_B = ["Drive", "Outlook", "Discord", "Jira", "HubSpot", "Zoom", "Airtable", "Asana"];

function ConnectorsDemo(): React.ReactElement {
  return (
    <div className="space-y-2.5">
      <MarqueeRow items={SERVICES_A} />
      <MarqueeRow items={SERVICES_B} reverse />
      <div className="flex items-baseline gap-2 pt-1.5">
        <span className="font-display text-[1.9rem] font-600 leading-none tracking-[-0.03em] text-text">
          1,000+
        </span>
        <span className="font-geist text-[13px] text-text-sec">apps, one secure layer</span>
      </div>
    </div>
  );
}

function MarqueeRow({
  items,
  reverse = false,
}: {
  readonly items: ReadonlyArray<string>;
  readonly reverse?: boolean;
}): React.ReactElement {
  const doubled = [...items, ...items];
  return (
    <div className="relative overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_12%,#000_88%,transparent)]">
      <div
        className="marquee-track flex gap-2"
        style={reverse ? { animationDirection: "reverse" } : undefined}
      >
        {doubled.map((s, i) => (
          <span
            key={`${s}-${i}`}
            className="shrink-0 whitespace-nowrap rounded-full border border-border bg-bg-card px-3 py-1.5 font-geist text-[12.5px] text-text-sec"
          >
            {s}
          </span>
        ))}
      </div>
    </div>
  );
}

// Build — a tiny editor with a resolving diff line + green test result.
function BuildDemo(): React.ReactElement {
  const lines = [
    { n: 41, t: "export function priceFor(plan: Plan) {", kind: "ctx" as const },
    { n: 42, t: "  return TIERS[plan].monthly;", kind: "del" as const },
    { n: 43, t: "  return TIERS[plan][cycle];", kind: "add" as const },
    { n: 44, t: "}", kind: "ctx" as const },
  ];
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-[#0b0c0e] font-geist-mono text-[12px]">
      <div className="flex items-center gap-2 border-b border-border px-3.5 py-2 text-text-ter">
        <span className="size-2 rounded-full bg-white/12" />
        <span className="size-2 rounded-full bg-white/12" />
        <span className="size-2 rounded-full bg-white/12" />
        <span className="ml-1.5 text-[10px]">pricing.ts</span>
      </div>
      <div className="px-3.5 py-3">
        {lines.map((l) => (
          <div
            key={l.n}
            className="flex gap-3 leading-[1.7]"
            style={
              l.kind === "add"
                ? { background: "rgba(217,255,87,0.07)", boxShadow: "inset 2px 0 0 var(--accent)", animation: "diffResolve 3.6s ease-in-out infinite" }
                : l.kind === "del"
                  ? { color: "rgba(255,120,120,0.65)" }
                  : undefined
            }
          >
            <span className="w-5 shrink-0 select-none text-right text-text-ter">{l.n}</span>
            <span className="text-text-sec">
              {l.kind === "add" && <span className="text-accent">+ </span>}
              {l.kind === "del" && <span className="text-[rgba(255,120,120,0.65)]">- </span>}
              {l.t}
            </span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 border-t border-border px-3.5 py-2.5 font-geist text-[12px] text-text-sec">
        <span className="flex size-4 items-center justify-center rounded-full bg-accent">
          <Check size={10} strokeWidth={3} color="#14180a" />
        </span>
        12 tests passing · committed to <span className="text-text">feat/billing-cycle</span>
      </div>
    </div>
  );
}

// Web — a query, three sources, a synthesized answer with citations.
function WebDemo(): React.ReactElement {
  const sources = ["apple.com", "macrumors", "9to5mac"];
  return (
    <div className="rounded-xl border border-border bg-bg-card-2/60 p-4">
      <div className="flex items-center gap-2 font-geist-mono text-[12px]">
        <Globe size={13} strokeWidth={2} className="text-text-ter" />
        <span className="text-text">what changed in the latest macOS?</span>
      </div>
      <div className="mt-3.5 flex flex-wrap gap-2">
        {sources.map((s, i) => (
          <span
            key={s}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-card px-2.5 py-1 font-geist-mono text-[11px] text-text-sec"
            style={{ animation: `pulseDot 2.4s ease-in-out ${i * 0.25}s infinite` }}
          >
            <span className="size-1.5 rounded-full bg-accent" />
            {s}
          </span>
        ))}
      </div>
      <p className="mt-3.5 font-geist text-[13.5px] leading-relaxed text-text-sec">
        Three changes worth knowing, with a new control-center layout and a
        battery model that learns your day.{" "}
        <span className="text-text-ter">Pulled from 3 sources, just now.</span>
      </p>
    </div>
  );
}
