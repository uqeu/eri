interface Capability {
  readonly index: string;
  readonly title: string;
  readonly body: string;
  readonly detail: string;
}

const CAPABILITIES: ReadonlyArray<Capability> = [
  {
    index: "01",
    title: "It knows your day",
    body: "Phone eri isn't a stranger you re-explain yourself to. It's backed by the eri living on your computer — the one that watched you work this morning.",
    detail: "Ask what's left before a meeting and it answers from what actually happened, not a guess.",
  },
  {
    index: "02",
    title: "It remembers when",
    body: "Memory is bi-temporal: eri tracks both when something happened and when it learned it. Facts get superseded cleanly instead of piling up.",
    detail: "“What did I decide about pricing last week?” resolves to the decision that was true then.",
  },
  {
    index: "03",
    title: "It acts on your computer",
    body: "A text can open an app, edit a file, or send something — the cloud half relays the goal to the resident eri, which carries it out on your machine.",
    detail: "Anything risky — shipping, spending, deleting — stops and asks for an explicit Y first. Nothing risky is ever auto-confirmed.",
  },
  {
    index: "04",
    title: "Private by construction",
    body: "Only a small Tier-A profile is server-readable. Your full memory is a Tier-B blob your computer alone can decrypt.",
    detail: "Deep or sensitive questions relay home and are answered locally — the cloud never reads them in the clear.",
  },
];

export function PhoneCapabilities(): React.ReactElement {
  return (
    <div className="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2">
      {CAPABILITIES.map((cap) => (
        <article key={cap.index} className="card-lift bg-bg-card p-7 sm:p-8">
          <span className="mono-cap text-accent">{cap.index}</span>
          <h3
            className="mt-3 font-display text-text"
            style={{ fontSize: "1.5rem", fontWeight: 500, letterSpacing: "-0.02em" }}
          >
            {cap.title}
          </h3>
          <p className="mt-3 text-[15px] leading-relaxed text-text-sec">{cap.body}</p>
          <p className="mt-4 border-t border-border pt-4 text-[13.5px] leading-relaxed text-text-ter">
            {cap.detail}
          </p>
        </article>
      ))}
    </div>
  );
}
