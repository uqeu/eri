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
    tag: "Local-first inference",
    title: "Voice, gaze, and TTS run on your machine.",
    body: "Whisper transcribes, MediaPipe tracks your gaze, and the text-to-speech presets all execute on the laptop in front of you. Only the model call itself crosses the network — and only to the provider you point it at.",
    proof: "Audio frames and camera frames never touch our servers. 0 bytes off-device.",
  },
  {
    tag: "BYOK that actually works",
    title: "Your API keys live in OS Keychain.",
    body: "Bring your own keys for eri's engine, ElevenLabs, Anthropic, OpenAI, and Gemini. eri reads them from macOS Keychain at runtime and uses them for every call — including agent and inline-edit turns. We never proxy, mirror, or sync them.",
    proof: "Stored in macOS Keychain under com.eri.keys.* — never synced to our database.",
  },
  {
    tag: "Transparent routing",
    title: "See which model handled each turn.",
    body: "Every voice turn shows the model that answered, the token count, and the wall-clock latency in the iterator panel. When eri auto-routes between providers, you see the decision — not a vague \"Auto\" badge.",
    proof: "Each turn logs model, tokens, and latency in the turn footer. No hidden downgrades.",
  },
  {
    tag: "Hard-capped pricing",
    title: "No overage. No surprise invoice.",
    body: "Every paid tier has a fixed monthly cap on voice turns and a soft daily / hourly burst limit. When you hit the cap, eri pauses cloud turns and lets you bring your own key for the rest of the month. No metered backbill.",
    proof: "Tier limits enforced client-side. You never see a charge above the headline price.",
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
