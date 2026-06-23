import type { Metadata } from "next";
import { HomeHeader } from "@/components/home/HomeHeader";
import { MeshFooter } from "@/components/home/MeshFooter";
import { DownloadHero } from "@/components/download/DownloadHero";
import { Quickstart } from "@/components/download/Quickstart";
import { DayOne } from "@/components/download/DayOne";
import { RequirementsAndCli } from "@/components/download/RequirementsAndCli";

export const metadata: Metadata = {
  title: "Download eri for Mac · your computer, hands-free",
  description:
    "Get eri for Mac. Download, log in and sync your one memory, then hit ⌘⌥E to summon eri anywhere, hands-free. It sees your screen, runs your apps, listens, and texts you. Free to start; the phone comes along at no extra cost.",
};

// The download page — the front door. Light/white to match the homepage, scoped
// via `.theme-light`, with the homepage's floating glass header and mesh footer.
// The flow: a confident hero with the real eri composer pill and a big Download
// for Mac CTA, a three-step quickstart (download → sync → hotkey), the four
// things eri does on day one, and plain system requirements + the CLI option +
// the included phone.
//
// A slim dark "sky" band sits at the very top, behind the floating header, so
// the homepage's white header (designed to sit over the dark sunset hero) keeps
// its contrast here; it dissolves into the white page well above the fold. This
// echoes the homepage's sunset-becomes-eri motif without a heavy dark hero.
export default function DownloadPage(): React.ReactElement {
  return (
    <div className="theme-light relative bg-bg text-text">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 z-0 h-44"
        style={{
          background:
            "linear-gradient(180deg, #16131d 0%, #1b1726 42%, rgba(27,23,38,0.34) 74%, transparent 100%)",
        }}
      />
      <HomeHeader />
      <main className="relative z-10 pt-32">
        <DownloadHero />
        <Quickstart />
        <DayOne />
        <RequirementsAndCli />
      </main>
      <MeshFooter />
    </div>
  );
}
