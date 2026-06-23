import Link from "next/link";
import { OrbitMark } from "./OrbitMark";

// The calm left half of the sign-in split: a near-white warm surface that
// carries the eri wordmark (top), a living orbital centred in the middle (one
// mind, real apps orbiting and flipping), and the one-line claim (bottom). It
// sets a trustworthy mood while the card on the right does the work.

export function BrandAside(): React.ReactElement {
  return (
    <aside
      className="relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-between"
      style={{
        background:
          "linear-gradient(168deg, #fcfcfa 0%, #f6f5f1 52%, #f1f0ea 100%)",
        borderRight: "1px solid rgba(0,0,0,0.06)",
      }}
    >
      {/* Soft ambient field: two faint warm radials. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(72% 55% at 18% 8%, rgba(20,16,8,0.04) 0%, transparent 60%)," +
            "radial-gradient(60% 50% at 92% 96%, rgba(20,16,8,0.04) 0%, transparent 64%)",
        }}
      />

      {/* Wordmark, top-left. */}
      <div className="relative z-10 px-12 pt-12 xl:px-16 xl:pt-14">
        <Link
          href="/"
          aria-label="eri home"
          className="group inline-flex items-center outline-none"
          style={{
            fontFamily: "Funnel Display, system-ui, sans-serif",
            fontSize: "1.7rem",
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

      {/* The living orbital, centred in the panel. */}
      <div className="relative z-10 flex flex-1 items-center justify-center px-12 xl:px-16">
        <OrbitMark />
      </div>

      {/* The claim, anchored at the bottom. */}
      <div className="relative z-10 px-12 pb-14 xl:px-16">
        <h2
          className="max-w-md text-balance"
          style={{
            fontFamily: "Funnel Display, system-ui, sans-serif",
            fontSize: "clamp(2rem, 2.4vw, 2.7rem)",
            fontWeight: 500,
            lineHeight: 1.08,
            letterSpacing: "-0.035em",
            color: "#16140f",
          }}
        >
          The world&rsquo;s first digital human.
        </h2>
        <p
          className="mt-4 max-w-sm font-geist text-[15px] leading-relaxed"
          style={{ color: "#5c574c" }}
        >
          One mind across your computer and phone. It learns how you work, then
          does the work with you.
        </p>
      </div>
    </aside>
  );
}
