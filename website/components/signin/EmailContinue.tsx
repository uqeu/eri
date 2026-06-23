"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, Mail, Check } from "lucide-react";

// The email row on the sign-in card with a magic-link feel: enter your email,
// press Continue, and the field swaps to a calm "check your inbox" confirmation
// (a front-end mockup — no link is actually sent). The label is real and tied
// to the input; the button is verb + object.

const ACCENT = "#e0ff4f";

export function EmailContinue(): React.ReactElement {
  const [email, setEmail] = useState<string>("");
  const [sent, setSent] = useState<boolean>(false);

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!email.trim()) return;
    setSent(true);
  }

  if (sent) {
    return (
      <div
        className="flex items-start gap-3 rounded-xl px-4 py-4"
        role="status"
        aria-live="polite"
        style={{
          background: "#f6f5f1",
          border: "1px solid rgba(0,0,0,0.08)",
        }}
      >
        <span
          aria-hidden
          className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full"
          style={{ background: "#16140f", color: ACCENT }}
        >
          <Check size={15} strokeWidth={3} />
        </span>
        <div className="min-w-0">
          <p className="font-geist text-[14.5px] font-semibold text-[#1d1d1f]">
            Check your inbox
          </p>
          <p className="mt-0.5 break-words font-geist text-[13.5px] leading-relaxed text-[#5c574c]">
            We sent a sign-in link to {email}. Open it on this device to
            continue.
          </p>
          <button
            type="button"
            onClick={() => setSent(false)}
            className="mt-2 rounded font-geist text-[13px] font-medium text-[#1d1d1f] underline decoration-[rgba(0,0,0,0.25)] underline-offset-2 outline-none transition-colors hover:decoration-[#16140f] focus-visible:ring-2 focus-visible:ring-[#16140f]/30 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
          >
            Use a different email
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2.5" noValidate>
      <label htmlFor="signin-email" className="sr-only">
        Email address
      </label>
      <div className="relative">
        <Mail
          size={17}
          strokeWidth={2}
          aria-hidden
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#86868b]"
        />
        <input
          id="signin-email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-[52px] w-full rounded-xl bg-white pl-11 pr-4 font-geist text-[15px] text-[#1d1d1f] outline-none transition-[border-color,box-shadow] duration-200 placeholder:text-[#9a958b] focus-visible:border-[#16140f] focus-visible:shadow-[0_0_0_3px_rgba(22,20,15,0.08)]"
          style={{ border: "1px solid rgba(0,0,0,0.13)" }}
        />
      </div>

      <button
        type="submit"
        className="group flex h-[52px] items-center justify-center gap-2 rounded-xl px-5 font-geist text-[15px] font-semibold text-white outline-none transition-[transform,box-shadow] duration-200 hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-[#16140f]/35 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
        style={{
          background: "#16140f",
          boxShadow: "0 10px 26px -14px rgba(20,16,8,0.6)",
        }}
      >
        Continue with email
        <ArrowRight
          size={16}
          strokeWidth={2.4}
          className="transition-transform duration-200 group-hover:translate-x-0.5"
        />
      </button>
      <p className="px-1 font-geist text-[12.5px] leading-relaxed text-[#86868b]">
        We&rsquo;ll email you a magic link. No password to remember.
      </p>
    </form>
  );
}
