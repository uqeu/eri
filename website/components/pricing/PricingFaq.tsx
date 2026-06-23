import { Plus } from "lucide-react";

// Billing FAQ, in the same <details> pattern as the homepage so the page reads
// as one site. Answers the things a pricing page is actually asked: how the
// free plan works, what gets metered, and how billing adds up.

const QA: ReadonlyArray<{ q: string; a: string }> = [
  {
    q: "Is the Free plan really free?",
    a: "Yes. Free gives you eri on your Mac with a monthly allowance of cloud work, no card and no trial clock. Step up to Starter when you want to connect your apps and put eri on your phone, and to Pro for hands-free control.",
  },
  {
    q: "How do I start?",
    a: "Download eri for your Mac and sign in. On Free it lives on your Mac and learns you. Step up to Starter to connect your apps and get eri on your phone over iMessage, or Pro for hands-free control. The model it built for you comes with you.",
  },
  {
    q: "What exactly is metered?",
    a: "The cloud work eri does: the tokens it spends thinking, the actions it takes, the apps it drives for you. Every plan includes a monthly allowance; you only pay past that for the work eri actually ran.",
  },
  {
    q: "What if I barely use it one month?",
    a: "Then it stays close to the plan floor. Nothing meters while eri is idle, so a light month is a cheap month and a heavy month costs more. You can watch usage add up rather than find out at the end.",
  },
  {
    q: "Can eri spend money without asking?",
    a: "No. eri stops and checks with you before money moves, before mass messages go out, and before anything it can't undo. Everything else is logged and reversible.",
  },
];

export function PricingFaq(): React.ReactElement {
  return (
    <section className="mx-auto max-w-2xl px-6">
      <h2 className="text-center font-display text-[clamp(1.7rem,3.4vw,2.4rem)] font-600 leading-[1.05] tracking-[-0.03em] text-text">
        billing questions
      </h2>
      <div className="mt-10 divide-y divide-border border-y border-border">
        {QA.map((item) => (
          <details key={item.q} className="group py-1">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-left">
              <span className="font-geist text-[16.5px] font-medium text-text">{item.q}</span>
              <Plus
                size={18}
                strokeWidth={2}
                className="shrink-0 text-text-ter transition-transform duration-300 group-open:rotate-45"
              />
            </summary>
            <p className="max-w-prose pb-6 pr-8 font-geist text-[15px] leading-relaxed text-text-sec">{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
