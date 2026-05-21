"use client";

import { useSearchParams } from "next/navigation";

interface GoogleSignInButtonProps {
  label?: string;
}

/**
 * Google sign-in button. Renders a plain anchor that hits our server-side
 * OAuth start route — no Google JS SDK required. The visual G is a simple
 * four-color glyph; we intentionally avoid Google's pixel-perfect brand
 * mark so the button reads as ours, not theirs.
 */
export function GoogleSignInButton({
  label = "Continue with Google",
}: GoogleSignInButtonProps) {
  const params = useSearchParams();
  const next = params?.get("next");
  const href = next
    ? `/api/auth/google/start?next=${encodeURIComponent(next)}`
    : "/api/auth/google/start";

  return (
    <a
      href={href}
      className="flex items-center justify-center gap-3 w-full px-6 py-3 rounded-md border border-white/15 bg-black/30 text-paper font-medium hover:bg-black/50 hover:border-white/30 transition"
    >
      <GoogleG />
      <span>{label}</span>
    </a>
  );
}

function GoogleG() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
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
