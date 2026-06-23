import { Eye, MousePointerClick, Mic, MessageSquare } from "lucide-react";

// What you get the moment eri is installed. Four things it literally does on day
// one, each with a real example you'd say out loud. Not a feature grid for its
// own sake: these are the four verbs (sees, runs, hears, texts) that define the
// product.

interface Capability {
  readonly icon: React.ReactNode;
  readonly title: string;
  readonly body: string;
  readonly say: string;
}

const ITEMS: ReadonlyArray<Capability> = [
  {
    icon: <Eye size={19} strokeWidth={1.8} />,
    title: "It sees your screen",
    body: "eri reads whatever is in front of you and acts on it, no copy-paste. Look at something and ask about it.",
    say: "What's this error in my terminal?",
  },
  {
    icon: <MousePointerClick size={19} strokeWidth={1.8} />,
    title: "It runs your apps",
    body: "Real clicks in your real apps. It opens things, fills forms, and joins calls, confirming before anything risky.",
    say: "Open my email and join the 3pm call.",
  },
  {
    icon: <Mic size={19} strokeWidth={1.8} />,
    title: "It listens",
    body: "Talk to it hands-free. Say what you want and eri goes and does it across apps while you keep working.",
    say: "Draft a reply, then open my inbox.",
  },
  {
    icon: <MessageSquare size={19} strokeWidth={1.8} />,
    title: "It texts you",
    body: "The same eri reaches you on iMessage when you're away from the Mac. One memory, both places, no extra cost.",
    say: "Text me when the build finishes.",
  },
];

export function DayOne(): React.ReactElement {
  return (
    <section className="border-t border-border bg-bg-card/40">
      <div className="container py-20 lg:py-28">
        <div className="max-w-2xl">
          <h2
            className="font-display text-[clamp(2rem,3.6vw,3rem)] font-medium leading-[1.02] text-text"
            style={{ letterSpacing: "-0.025em", textWrap: "balance" }}
          >
            What you get on day one.
          </h2>
          <p className="mt-4 max-w-lg font-geist text-[16px] leading-relaxed text-text-sec">
            No setup project, no prompt engineering. Press the hotkey and try any
            of these out loud.
          </p>
        </div>

        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {ITEMS.map((c) => (
            <article
              key={c.title}
              className="flex flex-col rounded-2xl border border-border bg-bg p-6"
            >
              <span className="flex size-10 items-center justify-center rounded-xl bg-bg-card text-text shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)]">
                {c.icon}
              </span>
              <h3 className="mt-5 font-display text-[18px] font-medium leading-tight text-text">
                {c.title}
              </h3>
              <p className="mt-2 flex-1 font-geist text-[13.5px] leading-relaxed text-text-sec">
                {c.body}
              </p>
              <p className="mt-5 border-t border-border pt-4 font-geist text-[13px] italic leading-snug text-text-sec">
                &ldquo;{c.say}&rdquo;
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
