# Support, Documentation & Legal Notices — Design

**Date:** 2026-05-21
**Status:** Approved (Tier 1→4, Ontario law, non-incorporated operator)

## Context

`tryeri.ca` already ships placeholder pages for `/terms`, `/privacy`, `/security`, `/trust`, `/contact`, `/docs`. Existing copy makes corporate-fiction claims that contradict reality:

- "eri labs, inc., a Delaware corporation, San Francisco" — not real
- "annual third-party pentest", "Vanta SOC 2", "Supabase Frankfurt" — unverifiable
- "@eri.dev" email domain — actual domain is `tryeri.ca`
- "548 Market St, PMB 41284" mailing address — fabricated

The user is an independent operator, not a registered entity. Goal is to:

1. Match the *tone and visual structure* of Anthropic, ChatGPT, Cursor, Kimi legal/help pages
2. Honestly reflect "indie project, use at your own risk, we try our best"
3. Protect the operator from liability with strong disclaimers under Ontario law
4. Give users discoverable support and product docs

## Approach

Reframe everything around an **independent operator** model:
- "eri is operated by an independent developer based in Ontario, Canada"
- No corporate "we"; use "the operator" / "I" / "eri" interchangeably
- "Provided as-is, without warranty, use at your own risk" as a load-bearing disclaimer repeated where relevant
- Replace all `@eri.dev` with `@tryeri.ca`
- Remove SF address, Delaware, Vanta, fabricated pentest claims
- Keep architecturally-true claims (local voice/gaze, BYOK, no training on prompts) where they're verifiable from the codebase

## Page inventory

### Tier 1 — Legal/protective (this pass)
| Route | Purpose | Status |
|---|---|---|
| `/terms` | Terms of Use — Ontario law, indie operator, as-is, AUP cross-ref | rewrite |
| `/privacy` | Privacy — PIPEDA + GDPR + CCPA stance, no training, what's local | rewrite |
| `/legal` | Legal hub linking all the below | new |
| `/legal/acceptable-use` | What you can't do with eri | new |
| `/legal/sub-processors` | Stripe, Supabase, Vercel, Resend, model providers | new |
| `/legal/cookies` | Cookie notice (essential + analytics opt-out) | new |
| `/legal/ai-policy` | Model output disclaimer, training stance, hallucination warning | new |
| `/legal/disclaimer` | Standalone "use at your own risk" notice | new |

### Tier 2 — Trust & disclosure
| Route | Purpose | Status |
|---|---|---|
| `/trust` | Trust hub, honest compliance posture | rewrite (remove SOC2 lies) |
| `/security` | Security architecture (truthful version) | rewrite |
| `/security/disclosure` | Vulnerability disclosure / safe harbor | new |
| `/status` | Status placeholder | new (stub) |

### Tier 3 — Support hub
| Route | Purpose | Status |
|---|---|---|
| `/help` | Help Center hub, categorized | new |
| `/help/getting-started` | Install, sign in, first edit | new |
| `/help/account` | Sign in, OAuth, account deletion | new |
| `/help/billing` | Stripe, plans, refunds, taxes | new |
| `/help/troubleshooting` | Common errors | new |
| `/contact` | Restructure routing, fix address, remove @eri.dev | rewrite |

### Tier 4 — Product docs (skeleton only)
| Route | Purpose | Status |
|---|---|---|
| `/docs` | Hub | rewrite |
| `/docs/quickstart` | 10-min first edit | new |
| `/docs/ide` | IDE + AI panel | new |
| `/docs/sidecar` | Rust sidecar | new |
| `/docs/mcp` | MCP integration | new |
| `/docs/byok` | BYOK setup | new |

### Cross-cutting
- `FooterBig.tsx` — remove "eri labs, inc." + "made in san francisco" + fake build/status, add Legal column entries
- `SiteHeader.tsx` — no change needed
- Wire `/help`, `/legal`, `/status` into footer

## Tone references

- **Anthropic** legal: precise, neutral, AI-specific clauses (model outputs, training, residual rights). Adopt for: ToS structure, AI Policy, Privacy.
- **Cursor** legal: developer-tool-aware (telemetry opt-out, code privacy, BYOK framing). Adopt for: Privacy, Security architecture diagram.
- **OpenAI / ChatGPT Help Center**: short articles, search-first, categorized. Adopt for: `/help` IA.
- **Kimi** (Moonshot AI): plain-language, regional clarity. Adopt for: jurisdiction/contact clarity.

## Constraints

- Existing page style: `SiteHeader variant="solid"`, `FooterBig` or `Footer`, `max-w-3xl`, `font-display` headings, `text-accent` eyebrow, `text-muted` body, dark theme. **Match exactly.**
- TypeScript strict, `interface` for object shapes, `ReadonlyArray<T>`, no `any`.
- Static pages only. No client state needed except where existing pages already use `"use client"`.
- No new dependencies.

## Build order

1. Spec doc (this file) → commit
2. Tier 1 pages: `/terms`, `/privacy`, `/legal/*` (7 pages)
3. Footer cleanup (remove inc/SF, add new legal links)
4. Tier 2: `/trust`, `/security` rewrites + `/security/disclosure` + `/status`
5. Tier 3: `/contact` rewrite + `/help/*` (5 pages)
6. Tier 4: `/docs/*` (5 pages)
7. End-to-end self-review: search codebase for any remaining "eri labs, inc.", "Delaware", "San Francisco", "@eri.dev", "Vanta" and confirm scrubbed.

## Out of scope (for this pass)

- DPA (Data Processing Addendum) — not relevant for non-B2B indie operator
- ISO 27001, SOC 2, HIPAA claims — not real, do not assert
- Multi-language translations
- Search across help center (use anchor links for now)
- Actual `/status` infrastructure (just a stub page that says "no incidents")
