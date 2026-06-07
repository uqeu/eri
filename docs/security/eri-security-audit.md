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

## Full 50-category status (your list)
✅ fixed/safe in code · 🟡 partial · ⚠️ you (infra/dashboard/process) · 🔜 queued code

1. Exposed DB creds — ✅ server-only (`DATABASE_URL` env), never in client
2. Public .env — ⚠️ confirm `.env` gitignored + not committed
3. Hardcoded API keys — ✅ none; all via env (providers, Sentry, Resend)
4. Weak/missing auth — 🟢 bearer + rotating sessions · ⚠️ admin MFA
5. No authz checks — ✅ every query scoped to authed user
6. Users access others' data — ✅ audited clean
7. Open DB read/write — ✅ RLS now ON for all 11 tables
8. Misconfig Supabase/S3 — ✅ RLS fixed · ⚠️ confirm no public buckets + least-priv DB role
9. Admin routes unprotected — ✅ `is_admin` checked · ⚠️ admin MFA
10. Debug pages in prod — ✅ source maps off · ⚠️ confirm no debug routes
11. Build logs leak secrets — ⚠️ CI log hygiene (you)
12. Verbose errors — ✅ OAuth leak fixed · 🔜 general error-message pass
13. Leaked repo/history — ⚠️ keep repo private + gitleaks scan (you)
14. Secrets in frontend JS — ✅ none; keys server-only + source maps off
15. Client-only security checks — ✅ metering/quota server-authoritative
16. Missing input validation — 🔜 zod pass (basic parseBody exists)
17. SQL injection — ✅ parameterized everywhere
18. NoSQL injection — ✅ N/A (Postgres, parameterized)
19. XSS — 🟢 React escaping + CSP · 🔜 WKWebView markdown render review
20. CSRF — ✅ API is bearer (not cookie); OAuth state validated; refresh cookie SameSite=lax
21. Insecure file uploads — ✅ N/A in money path
22. Path traversal — ✅ agent file tools resolve within workspace
23. SSRF — 🔜 agent web-fetch allowlist (CSP connect-src scoped already)
24. Broken password reset — 🟢 token-based · 🔜 confirm expiry/single-use
25. Weak session mgmt — 🟢 rotating refresh · 🔜 M2 refresh-cookie httpOnly
26. JWT secrets — ⚠️ confirm strong/unique `JWT_SECRET` (you)
27. Overly permissive CORS — ✅ no wildcard; CSP scoped
28. Rate limits missing — ✅ FIXED — Upstash global on auth + AI endpoints
29. Public test/staging — ⚠️ protect preview deploys (you)
30. Default creds — ✅ none
31. Webhook sig verification — ⚠️ verify Stripe webhook sig when added (you/🔜)
32. Payment checks frontend-only — ✅ tier/quota + Stripe server-side
33. IDOR — ✅ clean
34. APIs trust user IDs/roles — ✅ id from validated bearer, never body
35. Logs leak tokens/PII — ✅ Sentry scrubbed · 🔜 general log-redaction pass
36. Source maps in prod — ✅ off
37. Dependency vulns — 🟡 14→11 (safe fix) · ⚠️ remaining need reviewed major bumps
38. Outdated packages — ⚠️ Dependabot/Renovate (you)
39. Prompt injection — 🟢 AGENTS.md/tool output fenced as data · 🔜 explicit policy + red-team
40. AI tools w/o perms — 🟢 confirm-gate on risky control actions; depth-0 gating
41. Excessive DB perms — ⚠️ app DB role least-privilege (you)
42. No audit logs — 🟢 `admin_audit_log` + `recordAudit` · 🔜 extend to security events
43. No monitoring/alerting — ✅ Sentry wired · ⚠️ set alerts (token spikes, auth failures)
44. No backup/restore — ⚠️ Supabase PITR + restore drill (you)
45. Public internal dashboards — 🟢 admin gated · ⚠️ confirm
46. Missing security headers — ✅ added (HSTS, CSP, nosniff, frame DENY, COOP, Permissions-Policy)
47. Cookies HttpOnly/Secure/SameSite — 🟡 access cookie hardened; refresh cookie httpOnly (🔜 M2)
48. Unencrypted sensitive data — 🟢 memory_blobs E2E-encrypted; Supabase at-rest on · ⚠️ confirm
49. Poor tenant isolation — ✅ user-scoped + RLS
50. Over-trusting generated code — 🟢 confirm-gates + diff review (process)

## The one rule (apply to every new feature)
> Can untrusted text make the agent spend money, read secrets, write files, run code, control the computer, or send data out?
> If yes → it needs scoping + confirmation + server-side metering + rate limit + audit log. The **runtime** enforces permissions; the model only requests.
