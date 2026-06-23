import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PhoneShowcase } from "./PhoneShowcase";

// Phone-page hero: the same eri, now reachable by a text. A live iMessage
// demo sits beside the claim. Light, Apple-clean.
export function PhoneHero(): React.ReactElement {
  return (
    <section className="relative overflow-hidden">
      {/* faint cool wash, like the homepage's clean surface */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(70% 50% at 50% -8%, rgba(29,29,31,0.035) 0%, transparent 70%)",
        }}
      />

      <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 pb-20 pt-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-8 lg:pb-28 lg:pt-16">
        {/* Copy */}
        <div className="order-2 lg:order-1">
          <h1
            className="font-display text-[#1d1d1f]"
            style={{
              fontSize: "clamp(2.7rem, 6vw, 4.6rem)",
              lineHeight: 0.98,
              letterSpacing: "-0.035em",
              fontWeight: 500,
              textWrap: "balance",
            }}
          >
            It lives in
            <br />
            your messages.
          </h1>

          <p className="mt-6 max-w-[30rem] font-geist text-[17px] leading-[1.55] text-[#515154]">
            The same eri that runs your Mac is right there in your messages, on
            iMessage, WhatsApp, Telegram, Slack and Discord. Tell it what you
            need on the go, and it replies with little mini apps you can tap, not
            walls of text. Pick a time, confirm a payment, send the reply, all
            without leaving the thread.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link
              href="/download"
              className="group inline-flex h-12 items-center gap-2 rounded-full bg-[#1d1d1f] px-6 font-geist text-[15px] font-semibold text-white transition-transform duration-200 ease-out hover:-translate-y-[2px]"
              style={{ boxShadow: "0 14px 34px -16px rgba(20,16,8,0.5)" }}
            >
              Get eri for macOS
              <ArrowRight
                size={16}
                strokeWidth={2.4}
                className="transition-transform duration-200 group-hover:translate-x-0.5"
              />
            </Link>
            <Link
              href="#text-it"
              className="inline-flex h-12 items-center gap-1.5 rounded-full border border-black/12 px-5 font-geist text-[15px] font-medium text-[#1d1d1f] transition-colors duration-200 hover:bg-[#f5f5f7]"
            >
              See it text back
            </Link>
          </div>
        </div>

        {/* Live phone */}
        <div className="order-1 flex justify-center lg:order-2 lg:justify-end">
          <PhoneShowcase />
        </div>
      </div>
    </section>
  );
}
