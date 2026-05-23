import Link from "next/link";
import { HeroDemo } from "./hero/HeroDemo";

export function Hero(): React.ReactElement {
  return (
    <section className="bg-bg text-text">
      <div className="container pt-24 pb-10 lg:pt-32 lg:pb-14">
        <div className="max-w-3xl mb-10 lg:mb-14">
          <h1 className="text-h1 text-balance mb-5">
            Speak the edit. eri watches where you&apos;re pointing.
          </h1>
          <p className="text-body text-text-sec max-w-prose">
            A local-first editor for voice, gaze, and diffusion. Audio and the camera frame never leave your laptop — bring your own key for the model calls that do.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link
              href="/download"
              className="inline-flex items-center rounded-md bg-sage-deep px-4 py-2 text-[14px] font-medium text-bg hover:bg-sage transition-colors"
            >
              Download for macOS <span className="ml-2">⤓</span>
            </Link>
            <Link
              href="/contact"
              className="inline-flex items-center rounded-md border border-border px-4 py-2 text-[14px] text-text hover:bg-bg-card transition-colors"
            >
              Request a demo <span className="ml-2">→</span>
            </Link>
          </div>
        </div>

        <HeroDemo />
      </div>
    </section>
  );
}
