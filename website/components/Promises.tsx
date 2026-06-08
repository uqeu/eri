// Four-wedge promises section — surfaces the differentiators eri builds toward
// without naming competitors. Each promise has a short headline, a plain-English
// explanation, and a single concrete proof point (mechanism / file path / flag).

interface Promise {
  readonly tag: string;
  readonly title: string;
  readonly body: string;
  readonly proof: string;
}

const PROMISES: ReadonlyArray<Promise> = [
  {
    tag: "Local across the stack",
    title: "Voice, gaze, Tab, apply, and the index live on your hardware.",
    body: "Local speech, gaze targeting, embedded completion, fast-apply, and the semantic index live on your machine. Only cloud-grade planning calls cross the network, and those are labeled as Eri Cloud turns.",
    proof: "Semantic index path: ~/.eri/index.sqlite — visible, portable, deletable.",
  },
  {
    tag: "Bundled, not metered",
    title: "Tab and edits are in the box.",
    body: "Tab completion runs in-process via embedded inference on your machine — bundled with the subscription, no per-token meter, no BYOK required to use it. Agent edits, semantic search, voice, gaze, MCP, and checkpoints all ride the same flat price.",
    proof: "Local Tab via embedded inference. Zero per-token cost on the heaviest call in the loop.",
  },
  {
    tag: "Transparent routing",
    title: "See which Eri route handled each turn.",
    body: "Every turn shows the Eri route, token count, and wall-clock latency in the iterator panel. When Eri switches from local work to cloud work, the decision is on screen.",
    proof: "Each turn logs route, tokens, and latency in the turn footer. No hidden downgrades.",
  },
  {
    tag: "Hard-capped pricing",
    title: "One price. Hard cap. No surprise invoice.",
    body: "Every paid tier has a fixed monthly headline price and a soft burst limit. There is no credit pool that empties at 30% of the month, no usage-based overage rolled to a separate invoice, no auto-routing that quietly bills against your card. When you hit the cap, eri pauses cloud turns and lets you bring your own key for the rest of the month.",
    proof: "No metered backbill. You never see a charge above the headline price.",
  },
];

export function Promises(): React.ReactElement {
  return (
    <section
      id="promises"
      className="relative border-t border-white/[0.08]"
    >
      <div className="mx-auto max-w-7xl px-6 py-24 sm:py-32">
        <div className="max-w-3xl">
          <p className="mono-cap text-accent">Promises</p>
          <h2 className="mt-5 font-display text-h2 text-balance font-normal leading-[1.02]">
            Four lines we don't blur.{" "}
            <span className="italic accent-shimmer">In plain English.</span>
          </h2>
          <p className="mt-5 text-body text-paper/60 max-w-2xl">
            We made a small number of architectural choices early and have
            stayed honest to them. Here are the four that show up the most in
            user questions.
          </p>
        </div>

        <div className="mt-14 grid gap-4 sm:grid-cols-2">
          {PROMISES.map((p) => (
            <article
              key={p.tag}
              className="card-lift rounded-xl border border-white/[0.08] bg-white/[0.02] p-7"
            >
              <p className="mono-cap text-accent">{p.tag}</p>
              <h3
                className="mt-4 font-display text-2xl text-paper text-balance"
                style={{ fontWeight: 400, letterSpacing: "-0.02em" }}
              >
                {p.title}
              </h3>
              <p className="mt-3 text-[14px] leading-relaxed text-paper/65">
                {p.body}
              </p>
              <div className="mt-5 flex items-start gap-3 rounded-md border border-white/[0.06] bg-bg-3/60 px-3.5 py-3">
                <span
                  aria-hidden
                  className="mt-[5px] inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                />
                <p className="font-mono text-[12px] leading-relaxed text-paper/80">
                  {p.proof}
                </p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
