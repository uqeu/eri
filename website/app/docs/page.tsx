import type { Metadata } from "next";
import { HomeHeader } from "@/components/home/HomeHeader";
import { MeshFooter } from "@/components/home/MeshFooter";
import { HideGlobalHeader } from "@/components/phone/HideGlobalHeader";
import { DocsExperience } from "@/components/docs/DocsExperience";

export const metadata: Metadata = {
  title: "Docs: eri",
  description:
    "How eri works, in plain words. Get started on your Mac, see what it can do, how it runs your apps connected or by hand, the thought stream it shows its work in, how it travels to your phone, and how trust, plans, and usage fit together.",
};

// The docs page. Wrapped in `.theme-light` so the shared bg/text tokens resolve
// to the Apple-clean palette, and bookended with HomeHeader + MeshFooter exactly
// like the phone and homepage. HideGlobalHeader suppresses the global dark
// SiteHeader for this route so the floating HomeHeader does not duplicate. The
// readable body, sticky left rail, and scroll-spy live in DocsExperience.
export default function DocsPage(): React.ReactElement {
  return (
    <div className="theme-light bg-bg text-text">
      <HideGlobalHeader />
      <HomeHeader />
      <main className="pt-32">
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-6 pb-14 pt-2">
          <h1
            className="max-w-3xl font-display text-[#1d1d1f]"
            style={{
              fontSize: "clamp(2.4rem, 5vw, 4rem)",
              lineHeight: 1.05,
              letterSpacing: "-0.03em",
              fontWeight: 500,
              textWrap: "balance",
            }}
          >
            Docs
          </h1>
          <p className="mt-5 max-w-2xl font-geist text-[18px] leading-relaxed text-[#515154]">
            A calm tour of how eri works. Get it running on your Mac, see what it
            does, and understand how it drives your apps, shows its work, travels
            to your phone, and keeps you in control. If the app ever differs from
            a page here, the app is the truth.
          </p>
        </section>

        <DocsExperience />
      </main>
      <MeshFooter />
    </div>
  );
}
