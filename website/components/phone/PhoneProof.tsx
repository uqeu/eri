import { RefreshCw } from "lucide-react";

// Three proof beats for the phone page. Not identical cards — a wide lead beat
// over two supporting ones, each with its own small schematic so the grid has
// rhythm instead of repetition.

function TextToDo(): React.ReactElement {
  // A miniature thread: request in, work done out.
  const turns: ReadonlyArray<{ you: string; eri: string }> = [
    { you: "reschedule dinner to friday", eri: "Done. Told everyone, updated the res." },
    { you: "what did I spend on travel this month", eri: "$1,240 across 3 trips. Want the breakdown?" },
  ];
  return (
    <div className="flex flex-col gap-2.5">
      {turns.map((t) => (
        <div key={t.you} className="flex flex-col gap-1.5">
          <span className="self-end rounded-[14px] rounded-br-[5px] bg-[#0b84ff] px-3 py-1.5 font-geist text-[12.5px] leading-snug text-white">
            {t.you}
          </span>
          <span className="self-start rounded-[14px] rounded-bl-[5px] bg-white px-3 py-1.5 font-geist text-[12.5px] leading-snug text-[#1d1d1f] shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
            {t.eri}
          </span>
        </div>
      ))}
    </div>
  );
}

function RemoteControl(): React.ReactElement {
  // The phone reaching the sleeping Mac at home.
  return (
    <div className="flex items-center justify-center gap-3 py-1.5">
      {/* phone */}
      <div className="relative h-[68px] w-[36px] shrink-0 rounded-[9px] bg-[#1d1d1f] p-[3px]">
        <div className="grid h-full w-full place-items-center rounded-[7px] bg-white">
          <span className="font-display text-[11px] font-semibold text-[#1d1d1f]" style={{ letterSpacing: "-0.05em" }}>
            eri
          </span>
        </div>
      </div>
      {/* signal */}
      <div className="relative flex flex-1 items-center" aria-hidden>
        <div className="h-[2px] w-full rounded-full bg-gradient-to-r from-[#d8d8dc] via-[#1d1d1f] to-[#d8d8dc]" />
        <span
          className="absolute left-1/2 grid size-[22px] -translate-x-1/2 place-items-center rounded-full border border-black/10 bg-white"
          style={{ boxShadow: "0 4px 10px -4px rgba(20,16,8,0.3)" }}
        >
          <RefreshCw size={11} strokeWidth={2.4} color="#1d1d1f" />
        </span>
      </div>
      {/* mac */}
      <div className="shrink-0">
        <div className="h-[42px] w-[64px] rounded-md rounded-b-none border border-black/15 bg-[#0c0c0d] p-[3px]">
          <div className="grid h-full w-full place-items-center rounded-sm bg-[#1d1d1f]">
            <span className="font-display text-[13px] font-semibold text-[#e0ff4f]" style={{ letterSpacing: "-0.05em" }}>
              eri
            </span>
          </div>
        </div>
        <div className="h-[4px] w-[78px] -translate-x-[7px] rounded-b-[3px] bg-[#c4c4c8]" />
      </div>
    </div>
  );
}

function CrossDevice(): React.ReactElement {
  return (
    <div className="flex items-center justify-center gap-4 py-2">
      {[
        { label: "Mac", w: "w-[58px]", h: "h-[38px]" },
        { label: "Phone", w: "w-[26px]", h: "h-[46px]" },
      ].map((d) => (
        <div key={d.label} className="flex flex-col items-center gap-1.5">
          <div className={`${d.w} ${d.h} rounded-[7px] border border-black/12 bg-white p-1 shadow-[0_2px_8px_-3px_rgba(20,16,8,0.18)]`}>
            <div className="grid h-full w-full place-items-center rounded-[4px] bg-[#f5f5f7]">
              <span className="font-display text-[10px] font-semibold text-[#1d1d1f]" style={{ letterSpacing: "-0.05em" }}>
                eri
              </span>
            </div>
          </div>
          <span className="font-geist text-[11px] font-medium text-[#86868b]">{d.label}</span>
        </div>
      ))}
      <div className="flex flex-col items-center gap-1.5 font-geist text-[12px] text-[#515154]">
        <span>Same memory.</span>
        <span>Always in sync.</span>
      </div>
    </div>
  );
}

interface Beat {
  readonly title: string;
  readonly body: string;
  readonly visual: React.ReactNode;
  readonly wide?: boolean;
}

const BEATS: ReadonlyArray<Beat> = [
  {
    title: "It answers with something to tap.",
    body: "Text eri the way you'd text a friend who already knows your week. It comes back with a small card right in the thread, a time to pick, a payment to confirm, a draft to send, and one tap finishes the job.",
    visual: <TextToDo />,
    wide: true,
  },
  {
    title: "Reach your Mac from anywhere.",
    body: "Left a file open, or a render to kick off? eri can drive your Mac while you're away, and asks first before anything that matters.",
    visual: <RemoteControl />,
  },
  {
    title: "Pick up where you left off.",
    body: "What you start on your phone is waiting on your Mac, and the other way round. One mind in the cloud, so there's nothing to re-explain.",
    visual: <CrossDevice />,
  },
];

export function PhoneProof(): React.ReactElement {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20 lg:py-28">
      <div className="max-w-2xl">
        <h2
          className="font-display text-[#1d1d1f]"
          style={{
            fontSize: "clamp(2rem, 4vw, 3rem)",
            lineHeight: 1.04,
            letterSpacing: "-0.03em",
            fontWeight: 500,
            textWrap: "balance",
          }}
        >
          Like texting someone who already knows you.
        </h2>
      </div>

      <div className="mt-12 grid gap-4 md:grid-cols-2">
        {BEATS.map((beat) => (
          <article
            key={beat.title}
            className={[
              "group flex flex-col overflow-hidden rounded-3xl border border-black/[0.08] bg-[#f5f5f7] p-7 transition-shadow duration-300",
              "hover:shadow-[0_24px_60px_-30px_rgba(20,16,8,0.25)]",
              beat.wide ? "md:col-span-2" : "",
            ].join(" ")}
          >
            <div className={beat.wide ? "grid gap-7 md:grid-cols-[1.1fr_0.9fr] md:items-center" : ""}>
              <div>
                <h3
                  className="font-display text-[#1d1d1f]"
                  style={{ fontSize: "1.5rem", letterSpacing: "-0.02em", lineHeight: 1.1, fontWeight: 500 }}
                >
                  {beat.title}
                </h3>
                <p className="mt-3 max-w-prose font-geist text-[14.5px] leading-[1.55] text-[#515154]">
                  {beat.body}
                </p>
              </div>

              {/* visual surface */}
              <div
                className={[
                  "rounded-2xl border border-black/[0.06] bg-white/70 p-4",
                  beat.wide ? "mt-0" : "mt-6",
                ].join(" ")}
              >
                {beat.visual}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
