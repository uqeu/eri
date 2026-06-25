"use client";

import { useEffect, useRef, useState } from "react";

// A realistic iPhone running an iMessage thread with eri, powered by Spectrum.
// The thread plays itself in on a loop: you text a short request, eri "types",
// then replies with a short line and an interactive mini-app card rendered
// right inside the message — a native, tap-able widget, not just text. Built
// standalone for the phone page, with its own bubble + device vocabulary.

const EASE = "cubic-bezier(0.16,1,0.3,1)";

type Sender = "you" | "eri";
type Card = "reschedule" | "inbox" | "confirm";

interface Line {
  readonly from: Sender;
  readonly text: string;
  // An eri reply may render an interactive mini-app card under its line.
  readonly card?: Card;
}

const THREAD: ReadonlyArray<Line> = [
  { from: "you", text: "running late, move my 2pm?" },
  {
    from: "eri",
    text: "Sure. Pick a new time and I'll shuffle it.",
    card: "reschedule",
  },
  { from: "you", text: "what needs me in email?" },
  {
    from: "eri",
    text: "Four worth a look. Want me to draft the replies?",
    card: "inbox",
  },
  { from: "you", text: "pay mara back" },
  {
    from: "eri",
    text: "Found Mara, $40 from last week. Just confirm and it's done.",
    card: "confirm",
  },
];

// ── the three mini-apps ───────────────────────────────────────────────────

function RescheduleCard(): React.ReactElement {
  return (
    <div className="mini-card mini-card--in">
      <div className="mini-card__head">
        <img
          src="/logos/google-calendar.svg"
          alt=""
          aria-hidden
          loading="lazy"
          className="mini-card__logo"
        />
        <div>
          <div className="mini-card__title">Move your 2pm</div>
          <div className="mini-card__sub">Design review, 4 guests</div>
        </div>
      </div>
      <div className="mini-card__body">
        <div className="mini-pills">
          <span className="mini-pill mini-pill--on">2:30</span>
          <span className="mini-pill">3:15</span>
        </div>
        <div className="mini-toggle">
          <span>Tell the room you're running late</span>
          <span className="mini-switch" aria-hidden />
        </div>
      </div>
    </div>
  );
}

function InboxCard(): React.ReactElement {
  const rows: ReadonlyArray<{ from: string; line: string }> = [
    { from: "Mara Chen", line: "Re: contract, one date to confirm" },
    { from: "Stripe", line: "Payout of $2,140 is on the way" },
    { from: "Leah at Form", line: "Can we move Thursday's call?" },
  ];
  return (
    <div className="mini-card mini-card--in">
      <div className="mini-card__head">
        <img
          src="/logos/gmail.svg"
          alt=""
          aria-hidden
          loading="lazy"
          className="mini-card__logo"
        />
        <div>
          <div className="mini-card__title">4 emails need you</div>
          <div className="mini-card__sub">The rest can wait</div>
        </div>
      </div>
      <div className="mini-card__body">
        <div className="mini-list">
          {rows.map((r) => (
            <div key={r.from} className="mini-row">
              <span className="mini-row__from">{r.from}</span>
              <span className="mini-row__line">{r.line}</span>
            </div>
          ))}
        </div>
        <span className="mini-btn mini-btn--primary mini-btn--block">
          Draft replies
        </span>
      </div>
    </div>
  );
}

function ConfirmCard(): React.ReactElement {
  return (
    <div className="mini-card mini-card--in">
      <div className="mini-card__head">
        <span
          aria-hidden
          className="grid place-items-center rounded-[5px] text-[11px] font-semibold"
          style={{ width: 18, height: 18, background: "#1d1d1f", color: "#fff" }}
        >
          $
        </span>
        <div>
          <div className="mini-card__title">Send $40 to Mara?</div>
          <div className="mini-card__sub">Splitting last week's dinner</div>
        </div>
      </div>
      <div className="mini-card__body">
        <div className="mini-actions">
          <span className="mini-btn mini-btn--primary">Confirm</span>
          <span className="mini-btn mini-btn--ghost">Not now</span>
        </div>
        <p className="mini-cap-note">eri checks before money moves.</p>
      </div>
    </div>
  );
}

function MiniApp({ card }: { readonly card: Card }): React.ReactElement {
  if (card === "reschedule") return <RescheduleCard />;
  if (card === "inbox") return <InboxCard />;
  return <ConfirmCard />;
}

// ── the device ─────────────────────────────────────────────────────────────

export function PhoneShowcase(): React.ReactElement {
  // SSR + reduced-motion: render the full thread immediately (already visible).
  const [shown, setShown] = useState<number>(THREAD.length);
  const [typing, setTyping] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);

  // Keep the latest message in view as the thread grows. Honors the user's
  // manual scroll position is fine to override here since the loop owns the
  // playback; we snap to the bottom as each message appends.
  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    const reduce = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: reduce ? "auto" : "smooth",
    });
  }, [shown, typing]);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    let i = 0;
    const timers: number[] = [];
    setShown(0);

    const tick = (): void => {
      if (i >= THREAD.length) {
        // Hold the finished thread, then replay.
        timers.push(
          window.setTimeout(() => {
            i = 0;
            setShown(0);
            tick();
          }, 4600),
        );
        return;
      }
      const line = THREAD[i];
      if (line.from === "eri") {
        setTyping(true);
        timers.push(
          window.setTimeout(() => {
            setTyping(false);
            i += 1;
            setShown(i);
            timers.push(window.setTimeout(tick, line.card ? 1900 : 1000));
          }, 1250),
        );
      } else {
        i += 1;
        setShown(i);
        timers.push(window.setTimeout(tick, 1100));
      }
    };

    timers.push(window.setTimeout(tick, 700));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, []);

  return (
    <div className="relative mx-auto w-full max-w-[330px]" style={{ perspective: "1400px" }}>
      {/* Soft lime aura behind the device */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-x-16 -inset-y-10 -z-10"
        style={{
          background:
            "radial-gradient(48% 42% at 50% 38%, rgba(224,255,79,0.5) 0%, rgba(224,255,79,0) 70%)",
          filter: "blur(36px)",
        }}
      />

      {/* Device */}
      <div
        className="relative aspect-[295/600] w-full rounded-[54px] p-[11px]"
        style={{
          background: "linear-gradient(160deg, #2c2c2e 0%, #0c0c0d 52%, #1a1a1c 100%)",
          boxShadow:
            "0 2px 1px rgba(255,255,255,0.18) inset, 0 -1px 1px rgba(0,0,0,0.5) inset, 0 50px 90px -45px rgba(20,16,8,0.55), 0 22px 40px -28px rgba(20,16,8,0.4)",
        }}
      >
        {/* side buttons */}
        <span aria-hidden className="absolute -left-[2px] top-[120px] h-9 w-[3px] rounded-l bg-[#3a3a3c]" />
        <span aria-hidden className="absolute -left-[2px] top-[168px] h-14 w-[3px] rounded-l bg-[#3a3a3c]" />
        <span aria-hidden className="absolute -right-[2px] top-[150px] h-20 w-[3px] rounded-r bg-[#3a3a3c]" />

        {/* Screen */}
        <div className="relative flex h-full w-full flex-col overflow-hidden rounded-[44px] bg-white">
          {/* Dynamic island */}
          <span
            aria-hidden
            className="absolute left-1/2 top-[11px] z-20 h-[26px] w-[88px] -translate-x-1/2 rounded-full bg-black"
          />

          {/* Status bar */}
          <div className="flex items-center justify-between px-7 pb-1 pt-3.5 font-geist text-[13px] font-semibold text-[#1d1d1f]">
            <span>9:41</span>
            <span className="flex items-center gap-1.5" aria-hidden>
              <SignalGlyph />
              <WifiGlyph />
              <BatteryGlyph />
            </span>
          </div>

          {/* Conversation header — frosted, like Messages: a circular contact
              avatar centered, name + chevron beneath, exactly like a real 1:1
              iMessage thread. */}
          <div
            className="z-10 flex flex-col items-center gap-1 border-b border-black/[0.06] px-4 pb-2 pt-2.5"
            style={{
              background: "rgba(249,249,251,0.86)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
            }}
          >
            <span
              aria-hidden
              className="grid size-[36px] place-items-center rounded-full font-display text-[13px] font-semibold"
              style={{
                background: "radial-gradient(circle at 38% 30%, #fff, #e0ff4f 58%, #c2dd2c)",
                color: "#2a3300",
                letterSpacing: "-0.05em",
              }}
            >
              eri
            </span>
            <span className="mt-0.5 flex items-center gap-0.5 font-geist text-[12px] font-semibold text-[#1d1d1f]">
              eri
              <svg width="6" height="10" viewBox="0 0 6 9" fill="none" aria-hidden>
                <path d="M1 1L5 4.5L1 8" stroke="#c4c4c8" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </div>

          {/* Thread — scrollable: it auto-scrolls to the newest message while
              the loop plays, and you can also scroll it by hand. `data-lenis-prevent`
              keeps the page's smooth-scroll from hijacking this inner scroll. */}
          <div
            ref={threadRef}
            data-lenis-prevent
            className="ph-thread flex flex-1 flex-col gap-2 px-3 py-3"
          >
            {/* Conversation timestamp, like the top of a real Messages thread. */}
            <div className="pb-1 pt-0.5 text-center font-geist text-[10.5px] text-[#8e8e93]">
              <span className="font-semibold">Today</span> 9:41 AM
            </div>
            {THREAD.slice(0, shown).map((line, idx) => (
              <Bubble key={idx} line={line} />
            ))}
            {typing && <TypingBubble />}
          </div>

          {/* Composer */}
          <div className="flex items-center gap-2 px-3 pb-5 pt-1.5">
            <div className="flex h-9 flex-1 items-center rounded-full border border-black/10 pl-3.5 pr-1">
              <span className="font-geist text-[13px] text-[#a9a9ae]">iMessage</span>
              <span
                className="ml-auto grid size-7 place-items-center rounded-full"
                style={{ background: "#0b84ff" }}
                aria-hidden
              >
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                  <path d="M7 11.5V3M7 3L3.5 6.5M7 3l3.5 3.5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </div>
          </div>

          {/* Home indicator */}
          <span aria-hidden className="absolute bottom-2 left-1/2 h-[5px] w-[112px] -translate-x-1/2 rounded-full bg-black/85" />
        </div>
      </div>
    </div>
  );
}

function Bubble({ line }: { readonly line: Line }): React.ReactElement {
  const you = line.from === "you";
  return (
    <div
      className={`flex flex-col gap-1.5 ${you ? "items-end" : "items-start"}`}
      style={{ animation: `phMsgIn 0.42s ${EASE} both` }}
    >
      <span
        className={[
          "max-w-[83%] font-geist text-[13.5px] leading-[1.34]",
          "px-3.5 py-2",
          you
            ? "rounded-[20px] rounded-br-[7px] text-white"
            : "rounded-[20px] rounded-bl-[7px] text-[#1d1d1f]",
        ].join(" ")}
        style={you ? { background: "#0b84ff" } : { background: "#e9e9eb" }}
      >
        {line.text}
      </span>
      {line.card && <MiniApp card={line.card} />}
      <style>{`@keyframes phMsgIn{from{opacity:0;transform:translateY(7px) scale(0.97)}to{opacity:1;transform:none}}`}</style>
    </div>
  );
}

function TypingBubble(): React.ReactElement {
  return (
    <div className="flex items-start" style={{ animation: `phMsgIn 0.3s ${EASE} both` }}>
      <span
        className="inline-flex items-center gap-1 rounded-[20px] rounded-bl-[7px] px-3.5 py-3"
        style={{ background: "#e9e9eb" }}
        aria-label="eri is typing"
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="size-[6px] rounded-full bg-[#9a9aa0]"
            style={{ animation: `phType 1.2s ${i * 0.18}s ease-in-out infinite` }}
          />
        ))}
      </span>
      <style>{`@keyframes phType{0%,60%,100%{opacity:0.4;transform:translateY(0)}30%{opacity:1;transform:translateY(-3px)}}`}</style>
    </div>
  );
}

// Tiny status-bar glyphs (kept inline so the component is self-contained).
function SignalGlyph(): React.ReactElement {
  return (
    <svg width="17" height="11" viewBox="0 0 17 11" fill="#1d1d1f">
      <rect x="0" y="7" width="3" height="4" rx="1" />
      <rect x="4.5" y="5" width="3" height="6" rx="1" />
      <rect x="9" y="2.5" width="3" height="8.5" rx="1" />
      <rect x="13.5" y="0" width="3" height="11" rx="1" />
    </svg>
  );
}
function WifiGlyph(): React.ReactElement {
  return (
    <svg width="16" height="11" viewBox="0 0 16 12" fill="none">
      <path d="M8 10.2a1.4 1.4 0 100-2.8 1.4 1.4 0 000 2.8Z" fill="#1d1d1f" />
      <path d="M3.4 5.2A6.6 6.6 0 018 3.5a6.6 6.6 0 014.6 1.7M5.5 7.4A3.5 3.5 0 018 6.3a3.5 3.5 0 012.5 1.1" stroke="#1d1d1f" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
function BatteryGlyph(): React.ReactElement {
  return (
    <svg width="25" height="12" viewBox="0 0 25 12" fill="none">
      <rect x="0.5" y="0.5" width="21" height="11" rx="3" stroke="#1d1d1f" strokeOpacity="0.4" />
      <rect x="2" y="2" width="16" height="8" rx="1.6" fill="#1d1d1f" />
      <path d="M23 4v4a2 2 0 000-4Z" fill="#1d1d1f" fillOpacity="0.4" />
    </svg>
  );
}
