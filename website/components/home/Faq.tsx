import { Plus } from "lucide-react";

// Short, honest FAQ. Leads with the question the bold thesis invites — and
// answers it straight. Trust folds in here so the page stays minimal.

const QA: ReadonlyArray<{ q: string; a: string }> = [
  {
    q: "Is eri AGI?",
    a: "It’s a new definition of it. We call it Engineered Relative Intelligence: not one giant mind serving everyone, but an intelligence that’s born for you and grows relative to you. Today it’s already a capable agent that runs your apps, writes code, and learns you, and it only gets more yours over time.",
  },
  {
    q: "What makes it “relative”?",
    a: "It shapes itself to exactly one person. The longer you use it, its memory, its voice and its judgment all get shaped by you, until it’s a mind nobody else has. That’s the opposite of one model serving everyone the same.",
  },
  {
    q: "Does it really do things, or just chat?",
    a: "It does things. Eri drives your real apps for you, clicking, typing, booking, sending. It writes and ships code, joins your calls, and reaches over 1,000 services. The chat is just how you point it, it isn’t the product.",
  },
  {
    q: "Can I undo what it does? Is it safe?",
    a: "Eri logs everything it does and can undo anything reversible. For things it can’t take back, like money, mass messages, or deletions, it stops and checks with you first.",
  },
  {
    q: "Is my data private?",
    a: "Eri runs in the cloud, that’s where its mind lives, and the model of you is yours alone. You decide what it’s allowed to see and touch, and you can pull that access any time.",
  },
  {
    q: "What does it cost?",
    a: "There’s a free plan to start, then paid plans for hands-free control and more (you can see them on the pricing page). Mac first, with your phone included.",
  },
];

export function Faq(): React.ReactElement {
  return (
    <section className="bg-bg">
      <div className="mx-auto max-w-2xl px-6 py-24 lg:py-32">
        <h2 className="text-center font-display text-[clamp(1.9rem,4vw,2.7rem)] font-600 leading-[1.05] tracking-[-0.03em] text-text">
          questions you might have for us
        </h2>
        <div className="mt-12 divide-y divide-border border-y border-border">
          {QA.map((item) => (
            <details key={item.q} className="group py-1">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-left">
                <span className="font-geist text-[16.5px] font-medium text-text">{item.q}</span>
                <Plus size={18} strokeWidth={2} className="shrink-0 text-text-ter transition-transform duration-300 group-open:rotate-45" />
              </summary>
              <p className="max-w-prose pb-6 pr-8 font-geist text-[15px] leading-relaxed text-text-sec">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
