"use client";

import { PhoneFrame } from "../PhoneFrame";
import { MessageThread, type Msg } from "../MessageThread";

// One eri, one memory, across devices. The story is continuity: a fact eri
// learns at your desk is already known when you text it from your phone. Left:
// the Mac, where the memory was formed. Right: the phone, where it pays off.
// A lit conduit between them carries the same memory both ways.

const POCKET: ReadonlyArray<Msg> = [
  { from: "you", text: "good dinner spot for friday?", gapMs: 200 },
  {
    from: "eri",
    text: "Rintaro — you booked it last month and Sam loved it. Want 7pm?",
    typingMs: 1300,
  },
  { from: "you", text: "yes please", gapMs: 700 },
  { from: "eri", text: "Booked. Added it to your calendar.", typingMs: 1000, reaction: "heart" },
];

export function OneBrain(): React.ReactElement {
  return (
    <section className="relative overflow-hidden border-t border-border py-24 lg:py-32">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(42% 40% at 50% 12%, rgba(224,255,79,0.05) 0%, transparent 70%)",
        }}
      />
      <div className="container relative">
        <header className="mx-auto mb-14 max-w-2xl text-center">
          <h2 className="font-display text-balance text-[clamp(2rem,4.4vw,3.2rem)] font-600 leading-[1.04] tracking-[-0.03em] text-text">
            one eri. one memory. every device.
          </h2>
          <p className="mx-auto mt-5 max-w-lg text-pretty text-[16.5px] leading-relaxed text-text-sec">
            What it learns at your desk, it knows in your pocket. The same brain
            runs on your Mac and answers your texts, no re-explaining.
          </p>
        </header>

        <div className="mx-auto grid max-w-5xl items-center gap-8 lg:grid-cols-[1fr_auto_auto] lg:gap-4">
          {/* the Mac — where the memory was formed */}
          <div className="glass-soft rounded-2xl p-5 lg:p-6">
            <div className="mb-4 flex items-center gap-2.5">
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-white/12" />
                <span className="size-2 rounded-full bg-white/12" />
                <span className="size-2 rounded-full bg-white/12" />
              </span>
              <span className="font-geist-mono text-[10px] text-text-ter">eri · on your Mac</span>
            </div>

            <p className="font-geist text-[12px] text-text-ter">
              Learned last month
            </p>
            <div className="mt-3 space-y-2.5">
              {[
                "Rintaro is Sam’s favorite restaurant.",
                "You book date night about once a month.",
                "Sam prefers a 7pm table.",
              ].map((m) => (
                <div key={m} className="flex items-start gap-2.5">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" />
                  <span className="font-geist text-[14px] leading-snug text-text-sec">{m}</span>
                </div>
              ))}
            </div>

            <div className="mt-5 flex items-center gap-2 border-t border-border pt-4 font-geist-mono text-[11px] text-text-ter">
              <span className="size-1.5 rounded-full bg-accent" />
              written to your private memory
            </div>
          </div>

          {/* the conduit */}
          <Conduit />

          {/* the phone — where it pays off */}
          <div className="justify-self-center">
            <PhoneFrame width={250} height={464}>
              <MessageThread messages={POCKET} />
            </PhoneFrame>
          </div>
        </div>
      </div>
    </section>
  );
}

// A short lit line with a node travelling along it — the same memory moving
// between devices. Horizontal on desktop, vertical on mobile.
function Conduit(): React.ReactElement {
  return (
    <div className="relative mx-auto flex h-10 w-full items-center justify-center lg:h-44 lg:w-16">
      {/* line */}
      <span className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-[linear-gradient(90deg,transparent,rgba(224,255,79,0.5),transparent)] lg:left-1/2 lg:right-auto lg:top-0 lg:bottom-0 lg:h-auto lg:w-px lg:-translate-x-1/2 lg:translate-y-0 lg:bg-[linear-gradient(180deg,transparent,rgba(224,255,79,0.5),transparent)]" />
      {/* travelling node — the same memory moving between devices */}
      <span
        aria-hidden
        className="mem-node absolute size-1.5 rounded-full bg-accent"
        style={{ boxShadow: "0 0 10px 2px rgba(224,255,79,0.6)" }}
      />
      <span className="z-10 rounded-full border border-border bg-bg-card px-2.5 py-1 font-geist-mono text-[10px] text-text-sec">
        synced
      </span>
    </div>
  );
}
