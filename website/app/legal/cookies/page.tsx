import type { Metadata } from "next";
import { FooterBig } from "@/components/FooterBig";

export const metadata: Metadata = {
  title: "Cookies — eri",
  description:
    "What cookies tryeri.ca sets, why, and how to opt out of the optional ones.",
};

interface Cookie {
  readonly category: "Essential" | "Functional" | "Analytics";
  readonly name: string;
  readonly purpose: string;
  readonly lifetime: string;
}

const COOKIES: ReadonlyArray<Cookie> = [
  {
    category: "Essential",
    name: "eri_session",
    purpose:
      "Keeps you signed in. Required for the dashboard, billing, and account pages to work.",
    lifetime: "30 days, refreshed on activity",
  },
  {
    category: "Essential",
    name: "csrf_token",
    purpose:
      "Prevents cross-site request forgery on form submissions. Required for sign-in and account actions.",
    lifetime: "Session",
  },
  {
    category: "Functional",
    name: "eri_theme",
    purpose: "Remembers light/dark/system preference between visits.",
    lifetime: "1 year",
  },
  {
    category: "Analytics",
    name: "Anonymous page-view counter (if enabled)",
    purpose:
      "Counts how many people visit which pages so the operator knows what to fix next. No advertising trackers, no cross-site tracking, no identifiers tied to your account.",
    lifetime: "Up to 13 months",
  },
];

const STYLE_BY_CATEGORY: Record<Cookie["category"], string> = {
  Essential: "border-[#41d57c]/40 bg-[#41d57c]/[0.08] text-[#9deec5]",
  Functional: "border-accent/40 bg-accent/[0.08] text-accent",
  Analytics: "border-white/15 bg-white/[0.04] text-paper/75",
};

export default function CookiesPage() {
  return (
    <main>

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-20 sm:py-28">
          <p className="text-xs uppercase tracking-[0.25em] text-accent">
            Legal · Cookies
          </p>
          <h1 className="mt-5 font-display text-4xl sm:text-6xl tracking-tight text-balance">
            Cookie notice.
          </h1>
          <p className="mt-5 text-lg text-muted leading-relaxed">
            tryeri.ca runs lean. The cookies the website sets are the ones
            required to sign you in, the ones that remember small preferences,
            and an anonymous page counter. There are no ad trackers and no
            third-party cross-site cookies.
          </p>
          <p className="mt-6 font-mono text-[11px] uppercase tracking-wider text-paper/40">
            Last updated · May 21, 2026
          </p>
        </div>
      </section>

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
          <h2 className="font-display text-3xl sm:text-4xl tracking-tight">
            What gets set
          </h2>
          <ul className="mt-8 flex flex-col gap-3">
            {COOKIES.map((c) => (
              <li
                key={c.name}
                className="rounded-lg border border-white/10 bg-white/[0.02] p-6"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-display text-lg tracking-tight text-paper">
                    {c.name}
                  </h3>
                  <span
                    className={`inline-flex items-center rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider ${STYLE_BY_CATEGORY[c.category]}`}
                  >
                    {c.category}
                  </span>
                </div>
                <p className="mt-3 text-muted leading-relaxed">{c.purpose}</p>
                <p className="mt-3 font-mono text-[11px] uppercase tracking-wider text-paper/40">
                  Lifetime · {c.lifetime}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
          <h2 className="font-display text-3xl sm:text-4xl tracking-tight">
            Opting out
          </h2>
          <p className="mt-4 text-muted leading-relaxed">
            Essential cookies can&apos;t be turned off without breaking sign-in.
            Functional and analytics cookies can be turned off by clearing
            cookies for tryeri.ca in your browser and using Do Not Track or a
            similar setting — the website honours that signal where the
            analytics layer supports it. If your jurisdiction requires
            consent-based analytics, the analytics cookie is disabled by
            default until you opt in.
          </p>
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
          <h2 className="font-display text-3xl sm:text-4xl tracking-tight">
            Browser controls
          </h2>
          <p className="mt-4 text-muted leading-relaxed">
            Every modern browser lets you view and delete cookies per-site.
            Chrome and Edge: Settings → Privacy and security → Site settings.
            Safari: Settings → Privacy. Firefox: Settings → Privacy &amp;
            Security. Use those if you want a clean slate.
          </p>
        </div>
      </section>

      <FooterBig />
    </main>
  );
}
