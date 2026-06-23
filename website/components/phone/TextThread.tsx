interface Bubble {
  readonly from: "you" | "eri";
  readonly text: string;
  readonly note?: string;
}

const THREAD: ReadonlyArray<Bubble> = [
  { from: "you", text: "what's on my plate before the 2pm?" },
  {
    from: "eri",
    text: "Three things: finish the pricing draft, reply to Mara, and the deploy you paused this morning. Want me to resume the deploy?",
    note: "answered from your computer's memory",
  },
  { from: "you", text: "yeah resume it" },
  {
    from: "eri",
    text: "That ships to production. Confirm? (reply Y)",
    note: "risky — never auto-confirmed",
  },
];

/**
 * Editorial iMessage-style thread mockup for the hero. Static, decorative —
 * marked aria-hidden because the same content is conveyed in prose nearby.
 */
export function TextThread(): React.ReactElement {
  return (
    <div
      aria-hidden
      className="mx-auto w-full max-w-sm rounded-2xl border border-border bg-bg-card p-4 shadow-[0_24px_80px_-40px_rgba(0,0,0,0.8)]"
    >
      <div className="mb-4 flex items-center gap-2 border-b border-border pb-3">
        <span
          className="font-display text-text"
          style={{ fontSize: "1rem", fontWeight: 500, letterSpacing: "-0.05em" }}
        >
          eri
        </span>
        <span className="font-geist text-[12px] text-text-ter">iMessage</span>
      </div>

      <div className="space-y-3">
        {THREAD.map((b, i) => (
          <div
            key={i}
            className={b.from === "you" ? "flex flex-col items-end" : "flex flex-col items-start"}
          >
            <div
              className={
                b.from === "you"
                  ? "max-w-[82%] rounded-2xl rounded-br-md bg-bg-card-2 px-3.5 py-2 text-[13.5px] leading-snug text-text"
                  : "max-w-[88%] rounded-2xl rounded-bl-md border border-accent/25 bg-accent/[0.06] px-3.5 py-2 text-[13.5px] leading-snug text-text"
              }
            >
              {b.text}
            </div>
            {b.note ? (
              <span className="mt-1 px-1 font-geist text-[11px] text-text-ter">
                {b.note}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
