import { Check, Undo2, ShieldQuestion, ListChecks } from "lucide-react";

// Visible trust — the differentiator no rival makes legible. eri writes down
// everything it does, every action can be undone, and it stops to ask before
// anything irreversible. Shown as a real activity log (with per-action undo)
// plus one entry held for confirmation.

const POINTS: ReadonlyArray<{ icon: React.ReactNode; title: string; body: string }> = [
  {
    icon: <ListChecks size={16} strokeWidth={2} />,
    title: "Every action, logged",
    body: "A plain record of what eri did, when, and where — readable any time.",
  },
  {
    icon: <Undo2 size={16} strokeWidth={2} />,
    title: "Undo anything",
    body: "Changed your mind? Roll back a single action or the whole run.",
  },
  {
    icon: <ShieldQuestion size={16} strokeWidth={2} />,
    title: "Asks before anything risky",
    body: "Money, mass messages, deletions — eri pauses and waits for your yes.",
  },
];

const LOG: ReadonlyArray<{ text: string; when: string }> = [
  { text: "Replied to Priya", when: "2m ago" },
  { text: "Moved “Design review” to 3:30 PM", when: "2m ago" },
  { text: "Posted standup to #team", when: "14m ago" },
];

export function TrustBeat(): React.ReactElement {
  return (
    <section className="relative border-t border-border py-24 lg:py-32">
      <div className="container">
        <div className="mx-auto grid max-w-5xl items-center gap-12 lg:grid-cols-2 lg:gap-16">
          {/* the argument */}
          <div>
            <h2 className="font-display text-balance text-[clamp(2rem,4.2vw,3rem)] font-600 leading-[1.05] tracking-[-0.03em] text-text">
              you see everything it does. and undo any of it.
            </h2>
            <p className="mt-5 max-w-md text-pretty text-[16.5px] leading-relaxed text-text-sec">
              An agent that touches your real apps has to earn trust. eri does it
              the only honest way: in the open.
            </p>

            <ul className="mt-8 space-y-5">
              {POINTS.map((p) => (
                <li key={p.title} className="flex gap-3.5">
                  <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-bg-card text-accent">
                    {p.icon}
                  </span>
                  <div>
                    <p className="font-geist text-[15px] font-medium text-text">{p.title}</p>
                    <p className="mt-1 max-w-sm font-geist text-[14px] leading-relaxed text-text-sec">
                      {p.body}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* the activity log */}
          <div className="glass-soft rounded-2xl p-5 lg:p-6">
            <div className="mb-4 flex items-center justify-between">
              <span className="font-geist text-[13px] font-medium text-text">Activity</span>
              <span className="font-geist-mono text-[10px] text-text-ter">today</span>
            </div>

            <div className="space-y-2">
              {LOG.map((e) => (
                <div
                  key={e.text}
                  className="flex items-center gap-3 rounded-xl border border-border bg-bg-card px-3.5 py-3"
                >
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-accent">
                    <Check size={11} strokeWidth={3} color="#14180a" />
                  </span>
                  <span className="min-w-0 flex-1 truncate font-geist text-[13.5px] text-text">
                    {e.text}
                  </span>
                  <span className="shrink-0 font-geist-mono text-[10px] text-text-ter">{e.when}</span>
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-hidden
                    className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/[0.05] px-2.5 py-1 font-geist text-[11.5px] text-text-sec"
                  >
                    <Undo2 size={11} strokeWidth={2.2} />
                    Undo
                  </button>
                </div>
              ))}

              {/* the held action — eri waiting for a yes */}
              <div
                className="flex items-center gap-3 rounded-xl px-3.5 py-3"
                style={{ background: "rgba(224,255,79,0.06)", border: "1px solid rgba(224,255,79,0.2)" }}
              >
                <span
                  className="flex size-5 shrink-0 items-center justify-center rounded-full"
                  style={{ border: "1.5px solid var(--accent)" }}
                >
                  <ShieldQuestion size={11} strokeWidth={2.4} className="text-accent" />
                </span>
                <span className="min-w-0 flex-1 font-geist text-[13.5px] text-text">
                  About to email 1,240 customers
                  <span className="block font-geist text-[12px] text-text-sec">
                    Held for your confirmation.
                  </span>
                </span>
                <button
                  type="button"
                  tabIndex={-1}
                  aria-hidden
                  className="shrink-0 rounded-full bg-accent px-3 py-1.5 font-geist text-[12px] font-600 text-[#14180a]"
                >
                  Review
                </button>
              </div>
            </div>

            <p className="mt-4 flex items-center gap-2 border-t border-border pt-4 font-geist-mono text-[11px] text-text-ter">
              <span className="size-1.5 rounded-full bg-accent" />
              eri control --history · eri control --undo
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
