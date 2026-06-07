# eri Security Audit & Hardening — status + your action items

Living checklist for the money-path + platform security sweep. Legend:
**✅ FIXED** (code, verified) · **🟢 ALREADY SAFE** (audited, no change needed) ·
**⚠️ YOU** (needs your account/infra/migration — can't be done from code alone) ·
**🔜 NEXT** (code fix queued, no blocker).

Last updated: 2026-06-07. Branch: `feat/computer-control-p0`.

---

## ✅ Fixed this sweep (committed, tsc + tests green)

| # | Issue | Fix |
|---|-------|-----|
| C1 | **BYOK header → free inference** (any provider key skipped billing+quota+cost-guard) | `proxy.ts readBYOK` now gated behind server flag `ERI_ALLOW_BYOK` (default OFF); a header can't select the unbilled path |
| C2 | **Streamed turns billed as 0 tokens** when usage parse missed/threw | `proxy.ts finalizeStreamBilling` bills a conservative estimate (req tokens + `max_tokens`) and records even on parse failure — a served billed stream is never free |
| C3 | **`/turns/record` trusted client tokens/cost** | route now discards client billing numbers; server-derived row COUNT is authoritative |
| H3 | **Unknown model id priced at $0** | `tokens.ts` unknown models fall back to Opus-class rate (deny-by-default pricing) |
| #36 | **Prod source maps** (reverse-engineering) | `next.config.js productionBrowserSourceMaps: false` |
| #46 | **Missing security headers** | `next.config.js`: HSTS, nosniff, X-Frame-Options DENY, Referrer-Policy, COOP, Permissions-Policy, scoped CSP; `poweredByHeader: false` |
| #12 | **Verbose error leak** (OAuth) | callback no longer reflects internal error text into the redirect URL |
| #— | **Plus-address account farming** | signup canonicalizes email (`a+1@x.com`→`a@x.com`) for uniqueness |

## 🟢 Already safe (audited — no change needed)

- **#17 SQL injection** — every query uses parameterized `postgres` tagged-templates, including the **login path**. No string-built SQL anywhere.
- **#33/#6 IDOR / cross-user data** — every usage/billing/session/memory query is scoped to the authed user id from the validated bearer; admin routes check `is_admin`.
- **#3/#14 provider keys** — master keys are server-only (`process.env`), injected into the upstream auth header, never returned; inbound `authorization`/`x-eri-provider-key` are stripped before forwarding.
- **Usage metering authority** — the proxy derives tokens from the *upstream provider response* server-side, not from the client.

---

## ⚠️ YOUR action items (need your accounts / infra / a migration)

### A. Login + API rate limiting → shared store (HIGH)
In-process `Map` limiters (`lib/rate_limit.ts`, `inference/rate_limit.ts`, playground) reset per serverless instance, so under Vercel fan-out the effective limit is ~unbounded. **You:** provision **Upstash Redis** or **Vercel KV**, give me the env vars, and I'll swap the limiters to a shared token-bucket keyed on the **trusted** client IP + add a per-account failed-login lockout. (Covers #28.)

### B. 1 free account per IP / household (your explicit ask)
Needs a durable table. **You:** apply this migration in Supabase, then tell me and I'll wire the signup check (fail-open until applied):
```sql
create table if not exists signup_origins (
  ip_hash    text not null,
  user_id    text not null,
  created_at timestamptz not null default now()
);
create index if not exists signup_origins_ip_idx on signup_origins (ip_hash, created_at);
```
Enforcement I'll add: hash the trusted IP (HMAC with a server secret — never store raw IPs), reject a new **free** signup if an active free account already exists for that IP hash. Note: shared NAT/households/universities share an IP — pair it with email verification (C) and keep it free-tier-only so paying users are never blocked.

### C. Email verification before granting free quota (#— farming)
Stops disposable-inbox farming. **You:** confirm an email sender is configured (Resend/Postmark/SES) + apply:
```sql
alter table users add column if not exists email_verified_at timestamptz;
```
I'll then gate free-tier quota/credits behind a verified email + add the verify-link flow.

### D. Atomic quota reserve (H1 — cap race)
The quota gate is check-then-act, so concurrent requests at the cap can slip over (bounded by the rate limit). Fix is a DB-level atomic reserve. **You:** confirm it's fine to change `incrementTokensUsed`/`ensureWithinQuota`; I'll implement `UPDATE token_buckets SET tokens_used = tokens_used + :est WHERE tokens_used + :est <= cap RETURNING …` (reserve-then-reconcile). No new table; verify against the live DB.

### E. Sentry (recommended — yes)
Good to run, with guardrails. **You:** create the project, give me the DSN. I'll wire it with `beforeSend` PII scrubbing (never send prompts, code, tokens, secrets, emails), `tracesSampleRate` low, and **do not** upload source maps publicly. (Covers #43 monitoring, partially #42 audit.)

### F. Supabase / infra config (you own the dashboard)
- **#8/#7/#41** Enable **Row-Level Security** on every table; the app's DB role should have least privilege (no superuser). Confirm no table is world-readable.
- **#1/#2** Confirm no `.env` is committed/public and DB creds aren't in any client bundle (we ship none today).
- **#29/#10/#45** Ensure staging/preview deploys require auth and no debug pages ship to prod.
- **#44** Turn on Supabase PITR/backups + test a restore.
- **#26** Confirm `JWT_SECRET`/signing secrets are strong (32+ bytes random) and not reused across env.
- **#31** If you add Stripe/webhooks, verify signatures server-side.
- **#37/#38** Run `npm audit` / `cargo audit` + enable Dependabot/Renovate.

---

## 🔜 Next code batches (no blocker — I'll continue)

- **Auth hardening:** refresh cookie `httpOnly` (M2, needs a server-side bootstrap tweak), OAuth auto-link only for verified/OAuth-only accounts (M3), CSRF on state-changing form posts (#20), `SameSite`/`Secure`/`HttpOnly` audit on all cookies (#47).
- **Prompt-injection defense (#39/#40):** the agent already treats tool output + AGENTS.md as lower-trust data; add an explicit policy that on-screen/tool/web text can never trigger side-effectful actions without confirmation, and a red-team test suite.
- **Computer-control safety:** confirm-gate already covers quit/destructive; extend to send/purchase/delete + a per-action permission model + the panic-stop (shipped).
- **Cost guard → allowlist (H3 follow-up):** make `checkModelAllowed` deny-unknown rather than denylist.
- **Input validation pass (#16):** zod schemas on every API route body.
- **Loop/cost caps (#20 DoS / cost-explosion):** hard per-session + per-day token budget caps server-side.

---

## The one rule (apply to every new feature)
> Can untrusted text make the agent spend money, read secrets, write files, run code, control the computer, or send data out?
> If yes → it needs scoping + confirmation + server-side metering + rate limit + audit log. The **runtime** enforces permissions; the model only requests.
