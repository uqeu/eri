"use client";

import { useState } from "react";
import Link from "next/link";
import { Terminal, Copy, Check, Smartphone } from "lucide-react";

// The practical close: system requirements, the CLI install line for people who
// prefer the terminal, and the note that the phone comes along for free. Quiet,
// factual, the way a confident product states its specs.

const INSTALL = "curl -fsSL https://tryeri.ca/install | sh";

const REQUIREMENTS: ReadonlyArray<{ k: string; v: string }> = [
  { k: "Operating system", v: "macOS 13 Ventura or later" },
  { k: "Chip", v: "Apple silicon (M1+) or Intel" },
  { k: "Space", v: "About 280 MB" },
  { k: "Permissions", v: "Mic, screen recording, accessibility" },
  { k: "Account", v: "A free eri account to sync" },
  { k: "Cost", v: "Free to start, no card" },
];

function CopyLine(): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const onCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(INSTALL);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // clipboard blocked: leave the text for manual selection
    }
  };
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-bg px-4 py-3">
      <Terminal size={16} strokeWidth={1.9} className="shrink-0 text-text-ter" />
      <code className="flex-1 overflow-x-auto whitespace-nowrap font-geist-mono text-[13px] text-text">
        {INSTALL}
      </code>
      <button
        type="button"
        onClick={onCopy}
        aria-label={copied ? "Copied" : "Copy install command"}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-bg-card px-2.5 py-1.5 font-geist text-[12.5px] font-medium text-text-sec outline-none transition-colors duration-150 hover:text-text focus-visible:ring-2 focus-visible:ring-offset-2"
      >
        {copied ? (
          <Check size={13} strokeWidth={2.6} className="text-text" />
        ) : (
          <Copy size={13} strokeWidth={2} />
        )}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export function RequirementsAndCli(): React.ReactElement {
  return (
    <section className="container py-20 lg:py-28">
      <div className="grid gap-12 lg:grid-cols-[1fr_1fr] lg:gap-16">
        {/* System requirements */}
        <div>
          <h2
            className="font-display text-[clamp(1.6rem,2.6vw,2.1rem)] font-medium leading-tight text-text"
            style={{ letterSpacing: "-0.02em" }}
          >
            What you need
          </h2>
          <dl className="mt-7 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-bg-card/50">
            {REQUIREMENTS.map((r) => (
              <div
                key={r.k}
                className="flex items-baseline justify-between gap-6 px-5 py-3.5"
              >
                <dt className="font-geist text-[13.5px] text-text-sec">{r.k}</dt>
                <dd className="text-right font-geist text-[13.5px] font-medium text-text">
                  {r.v}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        {/* CLI + phone */}
        <div className="flex flex-col gap-8">
          <div>
            <h2
              className="font-display text-[clamp(1.6rem,2.6vw,2.1rem)] font-medium leading-tight text-text"
              style={{ letterSpacing: "-0.02em" }}
            >
              Prefer the terminal?
            </h2>
            <p className="mt-3 max-w-md font-geist text-[14.5px] leading-relaxed text-text-sec">
              Install the eri CLI for the same agent, scriptable:{" "}
              <code className="font-geist-mono text-[13px] text-text">eri chat</code>,{" "}
              <code className="font-geist-mono text-[13px] text-text">eri build</code>,{" "}
              <code className="font-geist-mono text-[13px] text-text">eri control</code>,{" "}
              <code className="font-geist-mono text-[13px] text-text">eri watch</code>.
            </p>
            <div className="mt-5">
              <CopyLine />
            </div>
            <p className="mt-3 font-geist text-[13px] text-text-ter">
              New to it? Start with the{" "}
              <Link
                href="/docs/quickstart"
                className="text-text underline decoration-border-strong underline-offset-2 transition-colors hover:decoration-text"
              >
                quickstart guide
              </Link>
              .
            </p>
          </div>

          {/* phone included */}
          <div className="flex items-start gap-4 rounded-2xl border border-border bg-bg-card/50 p-5">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-bg text-text shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)]">
              <Smartphone size={18} strokeWidth={1.8} />
            </span>
            <div>
              <p className="font-display text-[16px] font-medium text-text">
                Your phone is included
              </p>
              <p className="mt-1 font-geist text-[13.5px] leading-relaxed text-text-sec">
                Text the same eri on iMessage when you're away from the Mac. Same
                memory, same agent, no extra cost.{" "}
                <Link
                  href="/phone"
                  className="text-text underline decoration-border-strong underline-offset-2 transition-colors hover:decoration-text"
                >
                  See eri on your phone
                </Link>
                .
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
