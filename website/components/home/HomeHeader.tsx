"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, ArrowUpRight } from "lucide-react";

// Homepage header: a floating glass pill that holds the eri wordmark, a slim
// row of links, a Download CTA, and a sandwich menu. White and legible over
// the sunset hero; once you scroll past the fold it settles into a tinted-glass
// light bar with dark text. The menu opens as a staggered, blurred panel that
// drops from the right with an ease-out-expo curve.

const ACCENT = "#e0ff4f";

// Links that live inline on the pill at wide widths.
const PRIMARY: ReadonlyArray<{ href: string; label: string }> = [
  { href: "/phone", label: "Phone" },
  { href: "/pricing", label: "Pricing" },
  { href: "/docs", label: "Docs" },
];

// The full set the sandwich menu reveals (primary + account).
const MENU: ReadonlyArray<{ href: string; label: string; note: string }> = [
  { href: "/phone", label: "Phone", note: "eri on iMessage" },
  { href: "/pricing", label: "Pricing", note: "Plans and limits" },
  { href: "/docs", label: "Docs", note: "Guides and reference" },
  { href: "/careers", label: "Join us", note: "Help build eri" },
  { href: "/sign-in", label: "Sign in", note: "Pick up where you left off" },
];

export function HomeHeader(): React.ReactElement {
  const [solid, setSolid] = useState(false);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Only the homepage has a dark hero behind the header. Every other page
  // (pricing, phone, download) has a light top, so the header must read dark
  // (ink text) from the very top there, not white-on-white.
  const pathname = usePathname();
  const onHome = pathname === "/";

  useEffect(() => {
    const onScroll = (): void => setSolid(window.scrollY > 64);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close on Escape, and on a click outside the menu + its trigger.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    const onClick = (e: MouseEvent): void => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t)) return;
      if (buttonRef.current?.contains(t)) return;
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onClick);
    };
  }, [open]);

  // Dark (ink) chrome when scrolled onto the body, while the menu is open, or
  // on any page that isn't the dark-hero homepage.
  const dark = solid || open || !onHome;
  const ease = "cubic-bezier(0.16,1,0.3,1)"; // ease-out-expo

  return (
    <div className="fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-3 sm:px-6 sm:pt-4">
      {/* The floating pill */}
      <header
        className="relative flex w-full max-w-5xl items-center justify-between rounded-full pl-5 pr-2 transition-[background,box-shadow,border-color] duration-500"
        style={{
          height: 56,
          color: dark ? "#16140f" : "#ffffff",
          background: dark ? "rgba(252,252,250,0.72)" : "rgba(255,255,255,0.07)",
          border: dark
            ? "1px solid rgba(20,16,8,0.07)"
            : "1px solid rgba(255,255,255,0.16)",
          boxShadow: dark
            ? "0 12px 40px -20px rgba(20,16,8,0.30), inset 0 1px 0 rgba(255,255,255,0.7)"
            : "0 14px 50px -24px rgba(16,8,26,0.6), inset 0 1px 0 rgba(255,255,255,0.22)",
          backdropFilter: "blur(20px) saturate(1.6)",
          WebkitBackdropFilter: "blur(20px) saturate(1.6)",
          transitionTimingFunction: ease,
        }}
      >
        {/* Wordmark */}
        <Link
          href="/"
          aria-label="eri home"
          className="group flex shrink-0 items-center font-display outline-none"
          style={{
            fontSize: "1.5rem",
            fontWeight: 500,
            letterSpacing: "-0.05em",
            textShadow: dark ? "none" : "0 1px 16px rgba(16,8,26,0.4)",
          }}
        >
          <span className="transition-opacity duration-200 group-hover:opacity-70">
            eri
          </span>
        </Link>

        {/* Inline links — wide screens only */}
        <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 md:flex">
          {PRIMARY.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="group relative rounded-full px-3.5 py-2 font-geist text-[14px] font-medium outline-none transition-colors duration-200"
              style={{ color: "inherit" }}
            >
              <span className="relative z-10 transition-opacity duration-200 group-hover:opacity-90">
                {l.label}
              </span>
              {/* hover pill */}
              <span
                aria-hidden
                className="absolute inset-0 scale-90 rounded-full opacity-0 transition-all duration-200 group-hover:scale-100 group-hover:opacity-100"
                style={{
                  background: dark
                    ? "rgba(20,16,8,0.05)"
                    : "rgba(255,255,255,0.14)",
                  transitionTimingFunction: ease,
                }}
              />
              {/* lime underline tick */}
              <span
                aria-hidden
                className="absolute bottom-[7px] left-1/2 h-[2px] w-0 -translate-x-1/2 rounded-full transition-all duration-300 group-hover:w-3"
                style={{ background: ACCENT, transitionTimingFunction: ease }}
              />
            </Link>
          ))}
        </nav>

        {/* Right cluster */}
        <div className="flex shrink-0 items-center gap-1.5">
          <Link
            href="/download"
            className="group relative hidden items-center gap-1.5 overflow-hidden rounded-full px-[18px] font-geist text-[14px] font-semibold outline-none transition-transform duration-300 hover:-translate-y-[1px] focus-visible:ring-2 focus-visible:ring-offset-2 sm:flex"
            style={{
              height: 40,
              color: dark ? "#ffffff" : "#14110b",
              background: dark ? "#16140f" : "rgba(255,255,255,0.95)",
              boxShadow: dark
                ? "0 8px 24px -10px rgba(20,16,8,0.5)"
                : "0 10px 30px -10px rgba(16,8,26,0.35)",
              transitionTimingFunction: ease,
            }}
          >
            <span className="relative z-10">Download</span>
            <ArrowUpRight
              size={15}
              strokeWidth={2.4}
              className="relative z-10 transition-transform duration-300 group-hover:translate-x-[2px] group-hover:-translate-y-[2px]"
              style={{ transitionTimingFunction: ease }}
            />
            {/* lime sweep on hover */}
            <span
              aria-hidden
              className="absolute inset-0 -translate-x-full transition-transform duration-500 group-hover:translate-x-0"
              style={{
                background: `linear-gradient(90deg, transparent, ${ACCENT}38, transparent)`,
                transitionTimingFunction: ease,
              }}
            />
          </Link>

          <button
            ref={buttonRef}
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-haspopup="true"
            className="flex items-center justify-center rounded-full outline-none transition-[background,transform] duration-200 focus-visible:ring-2 focus-visible:ring-offset-2 active:scale-95"
            style={{
              width: 40,
              height: 40,
              color: "inherit",
              background: open
                ? dark
                  ? "rgba(20,16,8,0.07)"
                  : "rgba(255,255,255,0.2)"
                : dark
                  ? "rgba(20,16,8,0.04)"
                  : "rgba(255,255,255,0.12)",
              transitionTimingFunction: ease,
            }}
          >
            <span className="relative block h-[18px] w-[18px]">
              <Menu
                size={18}
                strokeWidth={2.2}
                className="absolute inset-0 transition-all duration-300"
                style={{
                  opacity: open ? 0 : 1,
                  transform: open ? "rotate(-90deg) scale(0.6)" : "none",
                  transitionTimingFunction: ease,
                }}
              />
              <X
                size={18}
                strokeWidth={2.2}
                className="absolute inset-0 transition-all duration-300"
                style={{
                  opacity: open ? 1 : 0,
                  transform: open ? "none" : "rotate(90deg) scale(0.6)",
                  transitionTimingFunction: ease,
                }}
              />
            </span>
          </button>
        </div>
      </header>

      {/* Menu panel — drops from the top-right under the pill */}
      <div
        ref={menuRef}
        className="absolute right-4 top-[68px] sm:right-6 sm:top-[76px]"
        aria-hidden={!open}
        style={{ pointerEvents: open ? "auto" : "none" }}
      >
        <div
          className="overflow-hidden rounded-[22px]"
          role="menu"
          style={{
            width: 268,
            transformOrigin: "top right",
            opacity: open ? 1 : 0,
            transform: open
              ? "translateY(0) scale(1)"
              : "translateY(-10px) scale(0.96)",
            background: "rgba(252,252,250,0.82)",
            border: "1px solid rgba(20,16,8,0.08)",
            boxShadow:
              "0 30px 70px -28px rgba(16,8,26,0.42), inset 0 1px 0 rgba(255,255,255,0.8)",
            backdropFilter: "blur(28px) saturate(1.7)",
            WebkitBackdropFilter: "blur(28px) saturate(1.7)",
            transition: `opacity 360ms ${ease}, transform 420ms ${ease}`,
          }}
        >
          <nav className="flex flex-col p-2.5">
            {MENU.map((l, i) => (
              <Link
                key={l.href}
                href={l.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className="group flex items-center justify-between rounded-2xl px-3.5 py-3 outline-none transition-colors duration-200 hover:bg-[rgba(20,16,8,0.045)] focus-visible:bg-[rgba(20,16,8,0.06)]"
                style={{
                  opacity: open ? 1 : 0,
                  transform: open ? "translateY(0)" : "translateY(6px)",
                  transition: open
                    ? `opacity 420ms ${ease} ${90 + i * 55}ms, transform 480ms ${ease} ${90 + i * 55}ms`
                    : "opacity 120ms ease, transform 120ms ease",
                }}
              >
                <span className="flex flex-col">
                  <span className="font-geist text-[15px] font-semibold text-[#16140f]">
                    {l.label}
                  </span>
                  <span className="font-geist text-[12.5px] text-[#6c675c]">
                    {l.note}
                  </span>
                </span>
                <ArrowUpRight
                  size={16}
                  strokeWidth={2.2}
                  className="shrink-0 -translate-x-1 text-[#b6b1a4] opacity-0 transition-all duration-300 group-hover:translate-x-0 group-hover:text-[#16140f] group-hover:opacity-100"
                  style={{ transitionTimingFunction: ease }}
                />
              </Link>
            ))}

            {/* Download row inside the menu, for narrow screens */}
            <Link
              href="/download"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="mt-1.5 flex items-center justify-center gap-1.5 rounded-2xl px-4 py-3 font-geist text-[14.5px] font-semibold text-white outline-none transition-transform duration-200 hover:-translate-y-[1px] focus-visible:ring-2 focus-visible:ring-offset-2 sm:hidden"
              style={{
                background: "#16140f",
                opacity: open ? 1 : 0,
                transform: open ? "translateY(0)" : "translateY(6px)",
                transition: open
                  ? `opacity 420ms ${ease} ${90 + MENU.length * 55}ms, transform 480ms ${ease} ${90 + MENU.length * 55}ms`
                  : "opacity 120ms ease, transform 120ms ease",
              }}
            >
              Download eri
              <ArrowUpRight size={15} strokeWidth={2.4} />
            </Link>
          </nav>
        </div>
      </div>
    </div>
  );
}
