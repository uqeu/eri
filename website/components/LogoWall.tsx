interface Logo {
  readonly label: string;
  readonly glyph: React.ReactElement;
}

const LOGOS: ReadonlyArray<Logo> = [
  {
    label: "Apple",
    glyph: (
      <svg viewBox="0 0 80 24" className="h-5 w-auto" aria-hidden>
        <path
          d="M16.5 12.6c0-2.7 2.2-4 2.3-4.1-1.3-1.8-3.2-2.1-3.9-2.1-1.7-.2-3.2 1-4.1 1-.8 0-2.1-1-3.5-.9C5.6 6.6 4 7.6 3 9.3c-1.8 3.2-.5 7.9 1.3 10.5.9 1.3 2 2.7 3.4 2.6 1.4-.1 1.9-.9 3.5-.9 1.6 0 2.1.9 3.5.9 1.5 0 2.4-1.3 3.3-2.6 1-1.5 1.4-2.9 1.4-3-.1 0-2.9-1.1-2.9-4.2zM13.9 4.7C14.7 3.8 15.2 2.5 15 1.3c-1.1 0-2.4.7-3.2 1.6-.7.8-1.4 2.1-1.2 3.3 1.2.1 2.5-.6 3.3-1.5z"
          fill="currentColor"
        />
        <text
          x="26"
          y="17"
          fontFamily="system-ui, -apple-system, sans-serif"
          fontSize="14"
          fontWeight="500"
          fill="currentColor"
          letterSpacing="-0.01em"
        >
          Apple
        </text>
      </svg>
    ),
  },
  {
    label: "Stripe",
    glyph: (
      <svg viewBox="0 0 80 24" className="h-5 w-auto" aria-hidden>
        <text
          x="0"
          y="17"
          fontFamily="system-ui, sans-serif"
          fontSize="16"
          fontWeight="700"
          fill="currentColor"
          letterSpacing="-0.02em"
        >
          stripe
        </text>
      </svg>
    ),
  },
  {
    label: "Vercel",
    glyph: (
      <svg viewBox="0 0 90 24" className="h-5 w-auto" aria-hidden>
        <path d="M12 4 L22 20 L2 20 Z" fill="currentColor" />
        <text
          x="28"
          y="17"
          fontFamily="system-ui, sans-serif"
          fontSize="14"
          fontWeight="700"
          fill="currentColor"
          letterSpacing="-0.02em"
        >
          Vercel
        </text>
      </svg>
    ),
  },
  {
    label: "Linear",
    glyph: (
      <svg viewBox="0 0 90 24" className="h-5 w-auto" aria-hidden>
        <rect
          x="2"
          y="2"
          width="20"
          height="20"
          rx="5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
        <text
          x="28"
          y="17"
          fontFamily="system-ui, sans-serif"
          fontSize="14"
          fontWeight="500"
          fill="currentColor"
          letterSpacing="-0.01em"
        >
          Linear
        </text>
      </svg>
    ),
  },
  {
    label: "Figma",
    glyph: (
      <svg viewBox="0 0 80 24" className="h-5 w-auto" aria-hidden>
        <circle cx="8" cy="12" r="4" fill="currentColor" />
        <rect x="4" y="2" width="8" height="8" fill="currentColor" opacity="0.7" />
        <text
          x="20"
          y="17"
          fontFamily="system-ui, sans-serif"
          fontSize="14"
          fontWeight="500"
          fill="currentColor"
          letterSpacing="-0.01em"
        >
          Figma
        </text>
      </svg>
    ),
  },
  {
    label: "Notion",
    glyph: (
      <svg viewBox="0 0 90 24" className="h-5 w-auto" aria-hidden>
        <rect
          x="3"
          y="3"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
        <path d="M8 8 L8 16 L16 16" stroke="currentColor" strokeWidth="2" fill="none" />
        <text
          x="28"
          y="17"
          fontFamily="Georgia, serif"
          fontSize="14"
          fontWeight="600"
          fill="currentColor"
        >
          Notion
        </text>
      </svg>
    ),
  },
  {
    label: "Shopify",
    glyph: (
      <svg viewBox="0 0 90 24" className="h-5 w-auto" aria-hidden>
        <path
          d="M12 3 L18 6 L18 20 L6 20 L6 6 Z"
          fill="currentColor"
          opacity="0.85"
        />
        <text
          x="24"
          y="17"
          fontFamily="system-ui, sans-serif"
          fontSize="13"
          fontWeight="600"
          fill="currentColor"
        >
          Shopify
        </text>
      </svg>
    ),
  },
  {
    label: "GitHub",
    glyph: (
      <svg viewBox="0 0 90 24" className="h-5 w-auto" aria-hidden>
        <path
          d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-1.96c-3.2.7-3.87-1.54-3.87-1.54-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.23-1.28-5.23-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.47.11-3.05 0 0 .97-.31 3.18 1.18.92-.26 1.91-.39 2.9-.39s1.98.13 2.9.39c2.21-1.49 3.18-1.18 3.18-1.18.63 1.58.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.43-2.69 5.39-5.25 5.68.41.36.78 1.05.78 2.12v3.14c0 .31.21.67.8.56C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z"
          fill="currentColor"
          transform="translate(0,1) scale(0.9)"
        />
        <text
          x="26"
          y="17"
          fontFamily="system-ui, sans-serif"
          fontSize="14"
          fontWeight="600"
          fill="currentColor"
        >
          GitHub
        </text>
      </svg>
    ),
  },
];

export function LogoWall(): React.ReactElement {
  return (
    <section className="border-t border-border">
      <div className="container py-12 sm:py-16">
        <p className="mono-cap text-text-sec mb-6 text-center">
          eri ships from engineers who&apos;ve built at
        </p>
        <div className="relative">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 w-12 bg-gradient-to-r from-bg to-transparent z-10"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-bg to-transparent z-10"
          />
          <div className="grid grid-cols-2 items-center gap-x-8 gap-y-6 sm:grid-cols-4 lg:grid-cols-7">
            {LOGOS.map((logo) => (
              <div
                key={logo.label}
                className="flex items-center justify-center text-text-sec transition-colors duration-200 hover:text-text"
                aria-label={logo.label}
                title={logo.label}
              >
                {logo.glyph}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
