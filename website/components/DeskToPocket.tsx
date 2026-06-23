"use client";

import { CompareSlider } from "./CompareSlider";
import { EriTrace } from "./EriTrace";
import { PhoneFrame } from "./PhoneFrame";
import { MessageThread, type Msg } from "./MessageThread";

// "Take eri on the go." A draggable wipe between eri running on your Mac (the
// live trace, in a window) and eri in your pocket (the iMessage thread). Same
// eri, same memory — desk → pocket.

const ON_THE_GO: ReadonlyArray<Msg> = [
  { from: "you", text: "running late — tell the team i'll be 10", gapMs: 200 },
  {
    from: "eri",
    text: "done. messaged the group and pushed standup 10 min.",
    typingMs: 1200,
    reaction: "heart",
  },
];

export function DeskToPocket(): React.ReactElement {
  return (
    <section className="border-t border-border py-24 lg:py-32">
      <div className="container">
        <header className="mx-auto mb-12 max-w-2xl text-center">
          <p className="font-geist-mono text-[11px] uppercase tracking-[0.2em] text-text-ter mb-4">
            your Mac → your pocket
          </p>
          <h2 className="font-geist text-[2.3rem] font-semibold leading-[1.05] tracking-[-0.035em] text-text lg:text-[3rem]">
            start it at your desk.{" "}
            <span className="font-instrument italic font-normal tracking-[-0.005em]">
              finish it on the go.
            </span>
          </h2>
          <p className="mx-auto mt-5 max-w-lg text-[17px] leading-relaxed text-text-sec">
            same eri, same memory — on your computer and in your pocket. drag to
            see it move.
          </p>
        </header>

        <div className="mx-auto max-w-5xl">
          <CompareSlider
            className="h-[460px] border border-border bg-[radial-gradient(120%_120%_at_50%_0%,#ffffff_0%,#f3eee4_58%,#e9e1d1_100%)] sm:h-[560px]"
            leftLabel="your Mac"
            rightLabel="your phone"
            top={
              <div className="absolute inset-0 flex items-center justify-start pl-5 sm:pl-12">
                <div className="w-full max-w-[500px]">
                  <EriTrace />
                </div>
              </div>
            }
            base={
              <div className="absolute inset-0 flex items-center justify-end pr-5 sm:pr-12">
                <PhoneFrame width={248} height={460}>
                  <MessageThread messages={ON_THE_GO} />
                </PhoneFrame>
              </div>
            }
          />
          <p className="mt-4 text-center font-geist-mono text-[11px] uppercase tracking-[0.18em] text-text-ter">
            ← drag the handle →
          </p>
        </div>
      </div>
    </section>
  );
}
