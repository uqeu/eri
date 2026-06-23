"use client";

import { MessageThread, type Msg } from "./MessageThread";

// eri on iMessage — the phone surface. You text eri from anywhere; it does the
// work on your Mac and texts back. Uses the shared MessageThread.

const THREAD: ReadonlyArray<Msg> = [
  { from: "you", text: "is the deck for my 2pm ready?", gapMs: 200 },
  { from: "eri", text: "not yet — it's missing the Q3 numbers.", typingMs: 1100 },
  {
    from: "eri",
    text: "want me to pull them from the sheet and drop them in?",
    typingMs: 900,
  },
  { from: "you", text: "yes pls", gapMs: 1400 },
  {
    from: "eri",
    text: "done. updated it and shared with the team.",
    typingMs: 1300,
    reaction: "heart",
  },
];

export function EriMessages(): React.ReactElement {
  return (
    <section className="border-t border-border py-24 lg:py-32">
      <div className="container">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <header className="max-w-lg">
            <p className="font-geist-mono text-[11px] uppercase tracking-[0.2em] text-text-ter mb-4">
              text it from anywhere
            </p>
            <h2 className="font-geist text-[2.3rem] font-semibold leading-[1.05] tracking-[-0.035em] text-text lg:text-[3rem]">
              text it. it does{" "}
              <span className="font-instrument italic font-normal tracking-[-0.005em]">
                the rest.
              </span>
            </h2>
            <p className="mt-5 max-w-md text-[17px] leading-relaxed text-text-sec">
              eri lives on your Mac and answers your texts — same brain, same
              memory. ask for something from your phone; it does the work on your
              computer and texts you back.
            </p>
            <ul className="mt-7 space-y-3">
              {[
                "no app to download — just text it like a friend",
                "it reads your files, calendar, and apps to actually finish the job",
                "same memory on your phone and your Mac",
              ].map((t) => (
                <li
                  key={t}
                  className="flex items-start gap-3 text-[15px] leading-snug text-text-sec"
                >
                  <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-[color:var(--accent-emerald)]" />
                  {t}
                </li>
              ))}
            </ul>
          </header>

          <div className="flex justify-center lg:justify-end">
            <div
              className="h-[520px] w-full max-w-[360px] overflow-hidden rounded-[28px] border border-border"
              style={{
                boxShadow:
                  "0 1px 2px rgba(28,26,23,0.04), 0 30px 60px -28px rgba(28,26,23,0.22)",
              }}
            >
              <MessageThread messages={THREAD} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
