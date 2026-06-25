"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { EriComposer } from "./EriComposer";
import { SyncViz } from "./SyncViz";

// Three full-page beats that stack as you scroll (codesandbox /features
// page-turn): computer, phone, fully synced. Light, off-white, square edges,
// visual alternates left/right. The computer beat uses the real eri overlay UI
// driving real apps (real logos). One scroll loop drives the recede.

interface Panel {
  readonly title: React.ReactNode;
  readonly body: string;
  readonly bg: string;
  readonly visualSide: "left" | "right";
  readonly visual: React.ReactNode;
  readonly cta?: boolean;
}

const APPS: ReadonlyArray<{ logo: string; name: string; act: string }> = [
  { logo: "cursor", name: "Cursor", act: "shipped the auth refactor" },
  { logo: "gmail", name: "Gmail", act: "cleared your inbox to zero" },
  { logo: "google-sheets", name: "Sheets", act: "fixed the Q3 model" },
  { logo: "youtube", name: "YouTube", act: "watching the talk with you" },
  { logo: "spotify", name: "Spotify", act: "queued your focus mix" },
];

// The real eri composer + a white activity card showing it working across apps.
function ComputerVisual(): React.ReactElement {
  return (
    <div className="flex w-full max-w-[440px] flex-col items-stretch gap-3">
      <EriComposer />
      <div className="eric-card">
        <div className="eric-card__head">running these for you</div>
        <div className="sp-apps">
          {APPS.map((a) => (
            <div key={a.name} className="sp-app">
              <Image src={`/logos/${a.logo}.svg`} alt={a.name} width={24} height={24} className="sp-app__logo" />
              <span className="sp-app__name">{a.name}</span>
              <span className="sp-app__act">{a.act}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const MSGS: ReadonlyArray<{ from: "you" | "eri"; text: string }> = [
  { from: "you", text: "running late, sort my morning?" },
  { from: "eri", text: "Moved your 9am to 9:30, told the team, and booked you a cab. 🚕" },
  { from: "you", text: "ur the best" },
  { from: "eri", text: "obviously 😌" },
];

// The thread types itself in on a loop (eri "types" before replying).
function PhoneVisual(): React.ReactElement {
  const [shown, setShown] = useState(MSGS.length); // SSR: full thread
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let i = 0;
    const timers: number[] = [];
    setShown(0);
    const tick = (): void => {
      if (i >= MSGS.length) {
        timers.push(window.setTimeout(() => { i = 0; setShown(0); tick(); }, 2800));
        return;
      }
      const m = MSGS[i];
      if (m.from === "eri") {
        setTyping(true);
        timers.push(window.setTimeout(() => {
          setTyping(false);
          i += 1; setShown(i);
          timers.push(window.setTimeout(tick, 750));
        }, 1100));
      } else {
        i += 1; setShown(i);
        timers.push(window.setTimeout(tick, 950));
      }
    };
    timers.push(window.setTimeout(tick, 650));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, []);

  return (
    <div className="iphone">
      <span className="iphone__island" aria-hidden />
      <div className="iphone__screen">
        <div className="iphone__status"><span>9:41</span><span className="iphone__sig" aria-hidden /></div>
        <div className="iphone__header">
          <span className="iphone__name">eri</span>
        </div>
        <div className="iphone__thread">
          {MSGS.slice(0, shown).map((m, i) => (
            <div key={i} className={`ibubble ibubble--${m.from} ibubble--in`}>{m.text}</div>
          ))}
          {typing && (
            <div className="ibubble ibubble--eri ityping" aria-label="eri is typing">
              <span /><span /><span />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


const PANELS: readonly Panel[] = [
  {
    title: <>it runs your<br />whole computer.</>,
    body: "Other AI agents are stuck in a browser tab. Eri uses your whole machine, so once you teach it, it can do anything you can: ship code in Cursor, clear your Gmail, fix your Sheets, queue your Spotify. The more you show it, the more it becomes you.",
    bg: "#ffffff",
    visualSide: "right",
    visual: <ComputerVisual />,
  },
  {
    title: <>it comes<br />with you.</>,
    body: "The same eri lives in your pocket. Text it to get things done on the go, then pick up right where you left off back on your Mac.",
    bg: "#f4f4f6",
    visualSide: "left",
    visual: <PhoneVisual />,
  },
  {
    title: <>one eri,<br />everywhere.</>,
    body: "Eri lives in the cloud, so it’s one mind across every device. Same memory, always in sync, awake even when you’re not.",
    bg: "#ffffff",
    visualSide: "right",
    visual: <SyncViz />,
    cta: true,
  },
];

export function StackPanels(): React.ReactElement {
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRefs = useRef<(HTMLElement | null)[]>([]);
  const innerRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    let queued = false;
    const update = (): void => {
      queued = false;
      const vh = window.innerHeight;
      for (let i = 0; i < PANELS.length - 1; i++) {
        const next = panelRefs.current[i + 1];
        const inner = innerRefs.current[i];
        if (!next || !inner) continue;
        const top = next.getBoundingClientRect().top;
        const cover = Math.max(0, Math.min(1, 1 - top / vh));
        inner.style.transform = `scale(${(1 - 0.06 * cover).toFixed(4)})`;
        inner.style.opacity = String((1 - 0.4 * cover).toFixed(3));
      }
    };
    const onScroll = (): void => {
      if (queued) return;
      queued = true;
      raf = requestAnimationFrame(update);
    };

    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          window.addEventListener("scroll", onScroll, { passive: true });
          update();
        } else {
          window.removeEventListener("scroll", onScroll);
        }
      },
      { threshold: 0 },
    );
    io.observe(wrap);

    return () => {
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div ref={wrapRef} className="sp-wrap">
      {PANELS.map((p, i) => (
        <section
          key={i}
          ref={(el) => { panelRefs.current[i] = el; }}
          className="sp-panel"
          style={{ background: p.bg, zIndex: i + 1 }}
        >
          <div
            ref={(el) => { innerRefs.current[i] = el; }}
            className={`sp-inner ${p.visualSide === "left" ? "sp-inner--vleft" : ""}`}
          >
            <div className="sp-copy">
              <h2 className="sp-title">{p.title}</h2>
              <p className="sp-body">{p.body}</p>
              {p.cta && (
                <div className="sp-cta">
                  <Link href="/download" className="sp-btn">
                    Download eri
                    <ArrowRight size={16} strokeWidth={2.4} />
                  </Link>
                </div>
              )}
            </div>
            <div className="sp-visual">{p.visual}</div>
          </div>
        </section>
      ))}
    </div>
  );
}
