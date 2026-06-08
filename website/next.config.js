/** @type {import('next').NextConfig} */

// Security headers applied to every response. Conservative, SOTA defaults:
// - HSTS so browsers refuse plaintext after first visit.
// - nosniff / frame DENY / referrer minimization / opener isolation.
// - A restrictive Permissions-Policy (we don't use these web APIs server-side).
// - A CSP that disallows objects/framing and scopes connect-src to our own
//   origin + the providers the dashboard talks to. Tighten further as pages allow
//   (consider Content-Security-Policy-Report-Only first if a strict CSP breaks UI).
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      // Next.js needs inline/eval for its runtime; scope to scripts only.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data: https:",
      "connect-src 'self' https://api.anthropic.com https://api.openai.com https://generativelanguage.googleapis.com https://api.inceptionlabs.ai https://api.deepseek.com",
      "upgrade-insecure-requests",
    ].join("; "),
  },
];

const nextConfig = {
  reactStrictMode: true,
  // Next 14 needs this flag for instrumentation.ts (Sentry server init). Stable
  // in Next 15 — drop the flag after upgrading.
  experimental: {
    instrumentationHook: true,
    // @sentry/node (and its OTEL auto-instrumentation helpers) use Node built-ins
    // and dynamic require hooks that webpack can't bundle. Mark them external so
    // they're require()'d at runtime on the Node server instead of bundled.
    serverComponentsExternalPackages: [
      "@sentry/node",
      "import-in-the-middle",
      "require-in-the-middle",
    ],
  },
  // Never ship readable source maps to the browser in production — they let
  // anyone reconstruct our client source (the "don't let them reverse-engineer
  // eri" requirement). Server-side logic stays on the server regardless.
  productionBrowserSourceMaps: false,
  // Don't leak the framework version.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // @sentry/node + its OpenTelemetry auto-instrumentation use Node built-ins
  // (node:child_process, worker_threads) and dynamic require hooks that webpack
  // can't bundle. On the server build, externalize the whole tree so it's
  // require()'d at runtime instead. Client/edge bundles never see it (the
  // instrumentation hook bails unless NEXT_RUNTIME === "nodejs").
  webpack(config, { isServer }) {
    if (isServer) {
      const externalize = [
        "@sentry/node",
        "@sentry/core",
        "@sentry/opentelemetry",
        "@opentelemetry/instrumentation",
        "import-in-the-middle",
        "require-in-the-middle",
      ];
      const original = config.externals;
      config.externals = [
        ({ request }, callback) => {
          if (
            request &&
            externalize.some(
              (p) => request === p || request.startsWith(`${p}/`),
            )
          ) {
            return callback(null, `commonjs ${request}`);
          }
          return callback();
        },
        ...(Array.isArray(original) ? original : original ? [original] : []),
      ];
    }
    return config;
  },
};

module.exports = nextConfig;
