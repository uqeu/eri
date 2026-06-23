"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

// The OAuth row on the sign-in card, tuned for the light theme. Google is a
// white card with a hairline border, linking to the real start route. (Apple
// sign-in isn't offered yet, so it's intentionally not shown.)

function startHref(provider: "google", next: string | null | undefined): string {
  const base = `/api/auth/${provider}/start`;
  return next ? `${base}?next=${encodeURIComponent(next)}` : base;
}

// Where to land after sign-in when no explicit `next` was passed: the
// dashboard, not the homepage.
const DEFAULT_NEXT = "/dashboard";

export function ProviderButtons(): React.ReactElement {
  return (
    <Suspense fallback={<ProviderButtonsInner next={DEFAULT_NEXT} />}>
      <ProviderButtonsWithParams />
    </Suspense>
  );
}

function ProviderButtonsWithParams(): React.ReactElement {
  const params = useSearchParams();
  return <ProviderButtonsInner next={params?.get("next") ?? DEFAULT_NEXT} />;
}

function ProviderButtonsInner({
  next,
}: {
  next: string | null;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-2.5">
      {/* Google — white card, hairline border. Real route. */}
      <a
        href={startHref("google", next)}
        className="group flex h-[52px] items-center justify-center gap-2.5 rounded-xl px-5 font-geist text-[15px] font-semibold outline-none transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-px hover:border-[rgba(0,0,0,0.2)] focus-visible:ring-2 focus-visible:ring-[#16140f]/30 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
        style={{
          color: "#1d1d1f",
          background: "#ffffff",
          border: "1px solid rgba(0,0,0,0.13)",
          boxShadow: "0 4px 14px -10px rgba(20,16,8,0.4)",
        }}
      >
        <GoogleG />
        Continue with Google
      </a>
    </div>
  );
}

function GoogleG(): React.ReactElement {
  return (
    <svg width="17" height="17" viewBox="0 0 18 18" aria-hidden>
      <path
        d="M17.64 9.2045c0-.6381-.0573-1.2518-.1636-1.8409H9v3.4814h4.8436c-.2086 1.125-.8427 2.0782-1.7959 2.7164v2.2581h2.9087c1.7018-1.5668 2.6836-3.874 2.6836-6.615z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.4673-.806 5.9564-2.1805l-2.9087-2.2581c-.806.54-1.8368.86-3.0477.86-2.344 0-4.3282-1.5832-5.036-3.7104H.957v2.3318C2.4382 15.9831 5.4818 18 9 18z"
        fill="#34A853"
      />
      <path
        d="M3.964 10.71c-.18-.54-.2823-1.1168-.2823-1.71s.1023-1.17.2823-1.71V4.9582H.957C.3477 6.1731 0 7.5477 0 9c0 1.4523.3477 2.8268.957 4.0418L3.964 10.71z"
        fill="#FBBC05"
      />
      <path
        d="M9 3.5795c1.3214 0 2.5077.4541 3.4405 1.346l2.5813-2.5814C13.4632.8918 11.426 0 9 0 5.4818 0 2.4382 2.0168.957 4.9582L3.964 7.29C4.6718 5.1627 6.656 3.5795 9 3.5795z"
        fill="#EA4335"
      />
    </svg>
  );
}
