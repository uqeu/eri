import type { Metadata } from "next";
import { HomeHeader } from "@/components/home/HomeHeader";
import { MeshFooter } from "@/components/home/MeshFooter";
import { ChannelChips } from "@/components/phone/ChannelChips";
import { HideGlobalHeader } from "@/components/phone/HideGlobalHeader";
import { PhoneHero } from "@/components/phone/PhoneHero";
import { PhoneProof } from "@/components/phone/PhoneProof";

export const metadata: Metadata = {
  title: "eri in your messages, replying with things you can tap",
  description:
    "The same eri that runs your Mac is right there in your messages, across iMessage, WhatsApp, Telegram, Slack and Discord. Text it like you'd text a friend, and it texts back with a card you can tap to finish the job. One mind, one memory, every device.",
};

// Phone page — matches the polished light homepage. The same eri, now reachable
// by a plain text. Hero with a live iMessage demo, a one-mind bridge line, and
// three proof beats. Wrapped in `.theme-light` so the shared bg/text tokens
// resolve to the Apple-clean palette; HomeHeader + MeshFooter bookend it exactly
// like the homepage.
export default function PhonePage(): React.ReactElement {
  return (
    <div className="theme-light bg-bg text-text">
      <HideGlobalHeader />
      <HomeHeader />
      <main className="pt-32">
        <PhoneHero />

        {/* Channels: the phone half runs on Spectrum, so eri shows up in every
            inbox you already use. */}
        <section className="mx-auto max-w-6xl px-6 pb-16">
          <ChannelChips />
        </section>

        {/* One-mind bridge: the claim that ties phone + Mac together. */}
        <section className="mx-auto max-w-6xl px-6 pb-4 pt-2">
          <div className="border-t border-black/[0.08] pt-12">
            <p
              className="max-w-4xl font-display text-[#1d1d1f]"
              style={{
                fontSize: "clamp(1.6rem, 3.2vw, 2.5rem)",
                lineHeight: 1.18,
                letterSpacing: "-0.025em",
                fontWeight: 500,
                textWrap: "balance",
              }}
            >
              It is not a second app with a second memory.{" "}
              <span className="text-[#86868b]">
                It is the same eri, in the cloud, so the conversation you started
                at your desk is the one waiting in your texts.
              </span>
            </p>
          </div>
        </section>

        <PhoneProof />
      </main>
      <MeshFooter />
    </div>
  );
}
