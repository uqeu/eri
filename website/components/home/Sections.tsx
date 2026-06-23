import { Check, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { OverlayPill, OverlayPanel } from "./OverlayShell";
import { PhoneFrame } from "../PhoneFrame";
import { MessageThread, type Msg } from "../MessageThread";

// Two tight proof beats. The thesis is bold ("becomes your AGI"), so these exist
// to prove the intelligence is REAL today — it acts in your world and reaches
// your apps — and that it's one mind across your devices. Light frosted eri
// (`.eov-light`) so it belongs on the white surface.

function Split({
  title,
  body,
  link,
  flip = false,
  tint = false,
  glow,
  children,
}: {
  readonly title: React.ReactNode;
  readonly body: string;
  readonly link?: { href: string; label: string };
  readonly flip?: boolean;
  readonly tint?: boolean;
  readonly glow?: string;
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className={tint ? "bg-bg-card" : "bg-bg"}>
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-16 lg:grid-cols-2 lg:gap-20 lg:py-24">
        <div className={flip ? "lg:order-2" : ""}>
          <h2 className="font-display text-balance text-[clamp(1.9rem,3.6vw,2.9rem)] font-600 leading-[1.05] tracking-[-0.03em] text-text">
            {title}
          </h2>
          <p className="mt-5 max-w-md text-pretty text-[17px] leading-relaxed text-text-sec">{body}</p>
          {link && (
            <Link href={link.href} className="group mt-6 inline-flex items-center gap-1.5 font-geist text-[15px] font-medium text-text">
              {link.label}
              <ArrowUpRight size={16} strokeWidth={2.2} className="text-text-ter transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </Link>
          )}
        </div>
        <div className={`relative flex justify-center ${flip ? "lg:order-1" : ""}`}>
          {glow && <div aria-hidden className="pointer-events-none absolute inset-0 -z-0" style={{ background: glow }} />}
          <div className="relative z-10 w-full">{children}</div>
        </div>
      </div>
    </section>
  );
}

const LOGOS = ["gmail", "google-calendar", "slack", "notion", "linear", "github", "figma", "dropbox", "discord", "zoom"] as const;

/* ── It's real today — acts in your world + reaches your apps ───────────── */
export function SectionRealToday(): React.ReactElement {
  const steps = [
    "Looked at your screen",
    "Opened Priya’s thread",
    "Drafted a reply in your voice",
    "Moved your 3pm → 3:30",
  ];
  return (
    <Split
      title="it does the work, and shows you every step."
      body="eri reads your screen and acts: replies, books, reschedules, writes code, across a thousand of your apps. Every action is logged, and you can undo it. It can do all of this today; it becomes yours as it learns you."
      link={{ href: "/features", label: "See what it does" }}
      glow="radial-gradient(60% 60% at 60% 35%, rgba(90,210,225,0.12) 0%, transparent 70%)"
    >
      <div className="mx-auto w-full max-w-[460px]">
        <div className="eov eov-light w-full">
          <OverlayPill listening={false} />
          <OverlayPanel entering={false} style={{ marginTop: 10 }}>
            <p className="eov-answer">
              <span className="text-[color:var(--eov-faint)]">“</span>reply to Priya, and push my 3pm back 30<span className="text-[color:var(--eov-faint)]">”</span>
            </p>
            <ol className="mt-4 space-y-2.5">
              {steps.map((s) => (
                <li key={s} className="flex items-center gap-2.5">
                  <span className="flex size-5 items-center justify-center rounded-full" style={{ background: "var(--eov-accent)" }}>
                    <Check size={12} strokeWidth={3} color="#14180a" />
                  </span>
                  <span className="font-geist text-[13.5px] text-[color:var(--eov-muted)]">{s}</span>
                </li>
              ))}
            </ol>
            <div className="mt-4 flex items-start gap-2.5 rounded-[13px] px-3.5 py-3" style={{ background: "rgba(160,190,20,0.12)", border: "1px solid rgba(160,190,20,0.3)" }}>
              <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full" style={{ background: "var(--eov-accent)" }}>
                <Check size={10} strokeWidth={3.5} color="#14180a" />
              </span>
              <p className="font-geist text-[13.5px] leading-relaxed text-[color:var(--eov-ink)]">
                Replied to Priya and pushed your 3pm to 3:30.
              </p>
            </div>
          </OverlayPanel>
        </div>

        {/* connectors, folded in — proof it reaches everything */}
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
          {LOGOS.map((file) => (
            <span key={file} className="flex size-9 items-center justify-center rounded-xl border border-border bg-bg">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/logos/${file}.svg`} alt="" aria-hidden width={20} height={20} loading="lazy" className="h-5 w-5 object-contain" />
            </span>
          ))}
          <span className="font-geist text-[13px] text-text-sec">+ 1,000 more</span>
        </div>
      </div>
    </Split>
  );
}

/* ── One mind, every device ─────────────────────────────────────────────── */
const POCKET: ReadonlyArray<Msg> = [
  { from: "you", text: "what’s a good dinner spot for friday?", gapMs: 200 },
  { from: "eri", text: "Rintaro — you booked it last month and Sam loved it. Want 7pm?", typingMs: 1300 },
  { from: "you", text: "yes please", gapMs: 700 },
  { from: "eri", text: "Booked. Added it to your calendar.", typingMs: 1000, reaction: "heart" },
];

export function SectionPhone(): React.ReactElement {
  return (
    <Split
      flip
      tint
      title="one mind. every device."
      body="The same eri runs on your Mac and answers your texts — one memory, everywhere. A mind that’s yours shouldn’t live on a single screen."
      link={{ href: "/phone", label: "How the phone works" }}
    >
      <div className="flex justify-center">
        <PhoneFrame width={272} height={510}>
          <MessageThread messages={POCKET} />
        </PhoneFrame>
      </div>
    </Split>
  );
}
