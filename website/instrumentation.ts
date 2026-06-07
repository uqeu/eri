// Next.js server instrumentation — initializes Sentry crash/error reporting on
// the server runtime only. We capture server-side errors (the money path:
// inference proxy, auth, billing) but NOT client telemetry.
//
// Privacy guardrails (do not relax): PII is OFF and a beforeSend scrubber strips
// anything that could carry prompts, code, secrets, tokens, cookies, headers, or
// user identity before an event leaves the box. No-op unless SENTRY_DSN is set.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  const Sentry = await import("@sentry/node");
  Sentry.init({
    dsn,
    sendDefaultPii: false,
    tracesSampleRate: 0.1,
    beforeSend(event) {
      // Strip request bodies/headers/cookies/query — they can carry prompts,
      // tokens, emails, or secrets.
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        delete event.request.headers;
        delete event.request.query_string;
      }
      // Never attach a user identity.
      delete event.user;
      delete event.server_name;
      return event;
    },
  });
}
