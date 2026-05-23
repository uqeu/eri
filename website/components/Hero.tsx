import Link from "next/link";
import { HeroDemo } from "./hero/HeroDemo";

export function Hero(): React.ReactElement {
  return (
    <section className="bg-bg text-text">
      <div className="container pt-20 pb-12 lg:pt-28 lg:pb-16">
        <div className="max-w-3xl mb-8">
          <h1 className="text-h1 text-balance mb-4">
            Built to make you extraordinarily productive in your editor.
          </h1>
          <p className="text-body text-text-sec max-w-prose">
            eri compiles your voice, gaze, and codebase into one diffused edit. Local-first, BYOK, no cloud round-trips for the things that matter.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link href="/download" className="inline-flex items-center rounded-md bg-sage-deep px-4 py-2 text-[14px] font-medium text-bg hover:bg-sage transition-colors">
              Download for macOS <span className="ml-2">⤓</span>
            </Link>
            <Link href="/contact" className="inline-flex items-center rounded-md border border-border px-4 py-2 text-[14px] text-text hover:bg-bg-card transition-colors">
              Request a demo <span className="ml-2">→</span>
            </Link>
          </div>
        </div>

        <HeroDemo />
      </div>
    </section>
  );
}
