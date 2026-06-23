import Link from "next/link";
import { Calendar, Check, MessageSquare, Mail, MapPin } from "lucide-react";
import { MessageThread, type Msg } from "./MessageThread";
import { PhoneFrame } from "./PhoneFrame";

const HERO_THREAD: ReadonlyArray<Msg> = [
  {
    from: "you",
    text: "book a table for two friday, somewhere good near me",
    gapMs: 200,
  },
  { from: "eri", text: "on it.", typingMs: 800 },
  {
    from: "eri",
    text: "rintaro, 7pm — 4.8★, 6 min away. booked it and texted sam to lock it in.",
    typingMs: 1500,
  },
  { from: "you", text: "you're the best", gapMs: 1300, reaction: "heart" },
];

export function Hero(): React.ReactElement {
  return (
    <section className="relative overflow-hidden bg-bg text-text">
      {/* warm ambient — committed colour, not beige */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(70% 55% at 78% 8%, rgba(238,90,54,0.16) 0%, transparent 60%)," +
            "radial-gradient(55% 50% at 6% 92%, rgba(244,180,90,0.14) 0%, transparent 60%)," +
            "radial-gradient(50% 40% at 50% 110%, rgba(80,160,110,0.07) 0%, transparent 70%)",
        }}
        aria-hidden
      />

      <div className="container relative pt-24 pb-24 lg:pt-28 lg:pb-32">
        <div className="grid items-center gap-14 lg:grid-cols-[1.02fr_0.98fr] lg:gap-10">
          {/* copy */}
          <div className="max-w-xl">
            <span className="mb-7 inline-flex items-center gap-2 rounded-full border border-[color:var(--warm)]/25 bg-[color:var(--warm-soft)] px-3 py-1 text-[12.5px] font-medium text-[color:var(--warm-deep)]">
              <span className="size-1.5 rounded-full bg-[color:var(--warm)]" />
              private alpha · now on macOS
            </span>

            <h1
              className="font-geist text-balance text-[3rem] leading-[0.98] tracking-[-0.04em] text-text sm:text-[3.8rem] lg:text-[4.5rem]"
              style={{ fontWeight: 640 }}
            >
              the friend who runs your computer.
            </h1>

            <p
              className="mt-7 max-w-lg text-[18.5px] leading-[1.5]"
              style={{ color: "#4a4439" }}
            >
              text it, talk to it, or just let it watch your screen. eri books the
              dinner, fixes the deck, writes the code, clears the busywork — right
              there on your Mac. less admin, more life.
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link
                href="/download"
                className="group inline-flex items-center gap-2 rounded-full px-6 py-3.5 text-[15px] font-semibold text-white transition-transform duration-200 ease-out hover:-translate-y-0.5 active:translate-y-0"
                style={{
                  background:
                    "linear-gradient(180deg, var(--warm) 0%, var(--warm-deep) 100%)",
                  boxShadow: "0 10px 26px -10px rgba(216,67,31,0.6)",
                }}
              >
                text eri
                <span
                  aria-hidden
                  className="transition-transform duration-200 group-hover:translate-x-0.5"
                >
                  →
                </span>
              </Link>
              <Link
                href="/docs"
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-5 py-3.5 text-[15px] font-medium text-text transition-colors duration-200 hover:bg-black/[0.03]"
              >
                see it work
              </Link>
            </div>

            <p className="mt-6 text-[14px]" style={{ color: "#8a8275" }}>
              no app to learn. you already know how to ask.
            </p>
          </div>

          {/* the conversation, composed with floating moments */}
          <div className="relative flex justify-center lg:justify-end">
            {/* glow behind the phone */}
            <div
              className="pointer-events-none absolute inset-0 -z-0"
              style={{
                background:
                  "radial-gradient(42% 42% at 60% 45%, rgba(238,90,54,0.22) 0%, transparent 70%)",
              }}
              aria-hidden
            />

            <div className="relative">
              <PhoneFrame width={314} height={624}>
                <MessageThread messages={HERO_THREAD} />
              </PhoneFrame>

              {/* floating moment: calendar event eri added */}
              <div className="float-slow absolute -left-10 top-12 hidden w-[210px] rounded-2xl border border-black/[0.06] bg-white/95 p-3.5 shadow-[0_20px_40px_-18px_rgba(40,33,22,0.30)] backdrop-blur sm:block">
                <div className="flex items-center gap-2">
                  <span className="flex size-7 items-center justify-center rounded-lg bg-[#EFF4FF] text-[#2f6bd8]">
                    <Calendar size={15} strokeWidth={2} />
                  </span>
                  <span className="text-[12px] font-semibold text-text">
                    added to calendar
                  </span>
                </div>
                <p className="mt-2 text-[12.5px] leading-snug text-[#5c554a]">
                  Fri · 7:00 PM — Dinner, Rintaro
                </p>
              </div>

              {/* floating moment: done toast */}
              <div className="float-mid absolute -right-8 top-28 hidden items-center gap-2 rounded-full border border-black/[0.06] bg-white/95 px-3.5 py-2 shadow-[0_18px_34px_-16px_rgba(40,33,22,0.30)] backdrop-blur sm:flex">
                <span className="flex size-5 items-center justify-center rounded-full bg-[color:var(--accent-emerald)]">
                  <Check size={11} strokeWidth={3.5} className="text-white" />
                </span>
                <span className="text-[12.5px] font-medium text-text">
                  booked &amp; texted Sam
                </span>
              </div>

              {/* floating moment: the apps it touched */}
              <div className="float-slow absolute -bottom-6 -left-6 hidden items-center gap-2 rounded-2xl border border-black/[0.06] bg-white/95 px-3 py-2.5 shadow-[0_20px_40px_-18px_rgba(40,33,22,0.30)] backdrop-blur sm:flex">
                {[
                  { icon: <MessageSquare size={13} strokeWidth={2} />, bg: "#E7F8EE", fg: "#2f7d4f" },
                  { icon: <Calendar size={13} strokeWidth={2} />, bg: "#EFF4FF", fg: "#2f6bd8" },
                  { icon: <Mail size={13} strokeWidth={2} />, bg: "#FFF1EC", fg: "#d8431f" },
                  { icon: <MapPin size={13} strokeWidth={2} />, bg: "#F3EEFF", fg: "#6d4fd8" },
                ].map((a, i) => (
                  <span
                    key={i}
                    className="flex size-7 items-center justify-center rounded-lg"
                    style={{ background: a.bg, color: a.fg }}
                  >
                    {a.icon}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
