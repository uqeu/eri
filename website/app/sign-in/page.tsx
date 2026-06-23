import type { Metadata } from "next";
import Link from "next/link";
import { BrandAside } from "@/components/signin/BrandAside";
import { ProviderButtons } from "@/components/signin/ProviderButtons";
import { EmailContinue } from "@/components/signin/EmailContinue";

// Sign-in — a calm, premium auth screen that matches the homepage's
// Apple-clean light surface. A full-screen split: a quiet brand panel on the
// left (wide screens), the sign-in card on the right. The card offers Apple +
// Google, then an email "magic link" path. No real auth wiring beyond the
// existing Google route; the rest is a faithful form mockup. Scoped to the
// light theme via `.theme-light` so the global dark tokens stay untouched.

export const metadata: Metadata = {
  title: "Sign in — eri",
  description:
    "Sign in to eri. Continue with Apple, Google, or an email magic link.",
};

export default function SignInPage(): React.ReactElement {
  return (
    <div className="theme-light bg-bg text-text">
      {/* The global SiteHeader (sticky, ~56px) sits above; the split fills the
          rest of the viewport so the page reads as one clean screen. */}
      <div className="grid min-h-[calc(100vh-56px)] lg:grid-cols-[1.05fr_1fr]">
        <BrandAside />

        {/* The card column. */}
        <main className="relative flex flex-col px-6 py-8 sm:px-10 sm:py-10">
          {/* Compact top row: wordmark (mobile only; the left panel carries it
              on desktop). The download CTA lives in the card body, so there's
              no second one here. */}
          <div className="flex items-center">
            <Link
              href="/"
              aria-label="eri home"
              className="group inline-flex items-center outline-none lg:invisible"
              style={{
                fontFamily: "Funnel Display, system-ui, sans-serif",
                fontSize: "1.5rem",
                fontWeight: 500,
                letterSpacing: "-0.05em",
                color: "#16140f",
              }}
            >
              <span className="transition-opacity duration-200 group-hover:opacity-70">
                eri
              </span>
            </Link>
          </div>

          {/* Centered card. */}
          <div className="flex flex-1 items-center justify-center py-10">
            <div className="w-full max-w-[400px]">
              <h1
                className="text-balance"
                style={{
                  fontFamily: "Funnel Display, system-ui, sans-serif",
                  fontSize: "clamp(2.1rem, 4vw, 2.6rem)",
                  fontWeight: 500,
                  lineHeight: 1.05,
                  letterSpacing: "-0.035em",
                  color: "#16140f",
                }}
              >
                Welcome back
              </h1>
              <p className="mt-2.5 font-geist text-[15px] leading-relaxed text-[#515154]">
                Pick up where you left off, on every device.
              </p>

              <div className="mt-8">
                <ProviderButtons />
              </div>

              {/* Divider. */}
              <div className="my-6 flex items-center gap-4">
                <span className="h-px flex-1 bg-[rgba(0,0,0,0.1)]" />
                <span className="font-geist text-[12.5px] font-medium text-[#86868b]">
                  or with email
                </span>
                <span className="h-px flex-1 bg-[rgba(0,0,0,0.1)]" />
              </div>

              <EmailContinue />

              {/* New here. */}
              <p className="mt-8 font-geist text-[14px] text-[#515154]">
                New here?{" "}
                <Link
                  href="/download"
                  className="rounded font-medium text-[#16140f] underline decoration-[rgba(0,0,0,0.25)] underline-offset-2 outline-none transition-colors hover:decoration-[#16140f] focus-visible:ring-2 focus-visible:ring-[#16140f]/30 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
                >
                  download eri
                </Link>{" "}
                to get started.
              </p>
            </div>
          </div>

          {/* Small print, anchored to the bottom of the card column. */}
          <p className="text-center font-geist text-[12px] leading-relaxed text-[#86868b]">
            By continuing you agree to the{" "}
            <Link
              href="/terms"
              className="rounded underline decoration-[rgba(0,0,0,0.2)] underline-offset-2 outline-none transition-colors hover:text-[#515154] focus-visible:ring-2 focus-visible:ring-[#16140f]/25 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
            >
              terms
            </Link>{" "}
            and{" "}
            <Link
              href="/privacy"
              className="rounded underline decoration-[rgba(0,0,0,0.2)] underline-offset-2 outline-none transition-colors hover:text-[#515154] focus-visible:ring-2 focus-visible:ring-[#16140f]/25 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
            >
              privacy policy
            </Link>
            .
          </p>
        </main>
      </div>
    </div>
  );
}
