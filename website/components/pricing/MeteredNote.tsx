import { Gauge, ToggleRight, Coins } from "lucide-react";

// The honest metering explainer, as its own quiet band rather than fine print.
// The point: overage is opt-in. You get an allowance, and you decide whether to
// keep going past it. No surprise bills, no asterisks hidden elsewhere.

const POINTS: ReadonlyArray<{ icon: typeof Gauge; title: string; body: string }> = [
  {
    icon: Gauge,
    title: "An allowance every month, included",
    body: "Each plan comes with a monthly allowance of cloud work. Nothing meters while eri is idle, so a quiet month stays near the plan floor.",
  },
  {
    icon: ToggleRight,
    title: "Going past it is opt-in",
    body: "When you reach your allowance, eri pauses paid work and asks. You choose whether to turn metered usage on, so a busy month never becomes a surprise bill.",
  },
  {
    icon: Coins,
    title: "Top up with eri credits",
    body: "Add credits whenever you want, like topping up API credits, and watch exactly what you have used on your dashboard, down to the token.",
  },
];

export function MeteredNote(): React.ReactElement {
  return (
    <section className="mx-auto max-w-6xl px-6">
      <div className="rounded-[24px] border border-border bg-bg-card px-7 py-9 sm:px-10 sm:py-11">
        <h2 className="max-w-xl font-display text-[clamp(1.5rem,3vw,2.1rem)] font-600 leading-[1.08] tracking-[-0.03em] text-text text-balance">
          How metered billing works
        </h2>
        <div className="mt-9 grid gap-x-10 gap-y-9 sm:grid-cols-3">
          {POINTS.map((p) => {
            const Icon = p.icon;
            return (
              <div key={p.title}>
                <span className="inline-flex size-9 items-center justify-center rounded-full bg-white text-text shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
                  <Icon size={17} strokeWidth={2} />
                </span>
                <h3 className="mt-4 font-geist text-[15px] font-600 text-text">{p.title}</h3>
                <p className="mt-2 max-w-[34ch] font-geist text-[14px] leading-relaxed text-text-sec">{p.body}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
