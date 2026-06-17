# eri Onboarding Spec — Learning the Essentials

> Status: proposal / implementation-ready. Author: research + spec pass, 2026-06-16.
> Scope: how eri gracefully learns the minimal set of things it needs to feel like
> *your* assistant — both proactively over iMessage and via a profile section on
> tryeri.ca. **No application code is changed by this doc.** This is the blueprint.

---

## 0. The problem, stated precisely

A brand-new eri user has texted a pairing code, gotten "You're linked!", and now
eri knows essentially nothing durable about them. Today the only floor of "knows
me" is the account identity row (`users.email`, `users.display_name`, `users.tier`)
merged into the prompt by `loadProfile` in
`website/app/api/v1/imessage/inbound/route.ts:179`. Everything richer
(`learned_facts`, the synced Tier-A `personalization_profiles` blob) only exists
*after* the user has volunteered it or the laptop has synced. So the first dozen
texts feel generic.

We want eri to (a) **notice** when it lacks the essentials and ask — conversationally,
one thing at a time, in its own voice — and (b) expose a **website profile section**
where a user can set the same essentials deliberately. Both surfaces write to the
**same backing store** so eri is consistent across phone and web.

---

## 1. Research: how to onboard a personal AI in 2024–2026

The consensus across product-UX and conversational-AI research is consistent and
maps cleanly onto eri's text-first surface:

1. **Ask only the absolute essentials up front; defer the rest (progressive
   profiling).** Don't front-load a form. Collect the minimum to be useful, then
   enrich opportunistically as the relationship continues. ([Userpilot — AI user
   onboarding](https://userpilot.com/blog/ai-user-onboarding/),
   [ProductLed — activate users in under 60s](https://productled.com/blog/ai-onboarding))
2. **One question per message.** Progressive disclosure — guide the user one step
   at a time — lowers cognitive load and keeps it feeling like a conversation, not
   an interrogation. This is the single most-repeated rule for chat onboarding.
   ([GetStream — Chat UX best practices](https://getstream.io/blog/chat-ux/),
   [Raw.Studio — Conversational UX](https://raw.studio/blog/conversational-ux-from-chatbots-to-ux-design/),
   [Fuselab — Chatbot UI patterns 2026](https://fuselabcreative.com/chatbot-interface-design-guide/))
3. **Get into a real conversation within ~60 seconds, then enhance over time.**
   Value first, profiling second; never gate usefulness behind a setup wizard.
   ([Userpilot](https://userpilot.com/blog/ai-user-onboarding/))
4. **Ask in context, when the info is actually needed, and explain *why*.** Adaptive
   probing ("I'd send this from your work address — which should I use?") beats a
   generic survey because the user sees the payoff. ([UX Design Institute — UX
   onboarding 2025](https://www.uxdesigninstitute.com/blog/ux-onboarding-best-practices-guide/),
   [arXiv: First Ask Then Answer](https://arxiv.org/html/2508.08308v1))
5. **The standard minimal field set for a personal assistant is: preferred
   name/identity, timezone/locale, role/what-you-do, and communication
   style/tone.** These four recur across every modern assistant-setup writeup as
   the things that make replies feel tailored from message one. ([UX Design
   Institute](https://www.uxdesigninstitute.com/blog/ux-onboarding-best-practices-guide/),
   [Tavus — AI onboarding assistant starter kit](https://www.tavus.io/post/starter-kit-how-create-ai-onboarding-assistant))
6. **Mirror the person, learn preferences over time.** Personal agents are expected
   to pick up communication style, cadence, and patterns from real interaction, not
   just a one-time setting. eri already has the seam for this
   (`TierAProfile.communication_style`, `lib/agent/run_core.ts:20`). ([Userpilot](https://userpilot.com/blog/ai-user-onboarding/))

**Translation to eri:** keep the *core* to 5 facts, ask at most one per text, never
block chat on setup, attach a reason to each ask, and let everything else be
learned/optional. The website mirrors the same fields for people who'd rather just
fill them in.

---

## 2. The standardized question set (eri's voice)

eri's voice per the brand guide: warm, human, lower-case-leaning, no
"Certainly!"/"As an AI", one 🌿 sparingly. Phrasing below is the canonical copy.

### 2a. Core 5 (the truly-minimal set eri proactively learns)

Ask these, **one per message**, only as gaps surface (see §4). Each has a *reason*
baked in so it never feels like a form.

| # | Field | eri's ask (canonical copy) | Why eri needs it |
|---|-------|----------------------------|------------------|
| 1 | **Preferred name** | "before I get too familiar — what should I call you? your account says **Khai Khanna**, want me to just go with **Khai**, or something else? 🌿" | How eri addresses the user in every reply. |
| 2 | **Timezone / location** | "quick one so I don't text you at a weird hour — where are you based? (just the city or country is plenty)" | Quiet-hours, "this morning", scheduling, "your 3pm". |
| 3 | **Action email** | "when I send things for you — emails, invites — which address should they come from? you're signed in as **bellkaizen@gmail.com**, but I can only act from accounts you've connected. want to use that one, or connect another?" | Which connected account eri sends/acts from. |
| 4 | **Role / what you do** | "what do you spend most of your day on? (your work, what you're building — helps me actually be useful instead of generic)" | Tailors suggestions, drafting tone, proactive nudges. |
| 5 | **Communication style** | (Usually *learned*, not asked — see note. If asked:) "last thing — do you like me short and to the point, or do you want me to explain more? and feel free to text me however you text — I'll match you." | How terse/formal eri is; eri mirrors register. |

> **Note on #5:** prefer to *infer* communication style from how the user texts
> (casing, brevity, emoji, slang) and store it into `communication_style` rather
> than asking. Only ask explicitly if the founder wants an explicit control. This
> matches the "mirror the person" memory facet already in the roadmap.

### 2b. Optional / progressive (never asked in a batch — surfaced in context)

These are learned opportunistically or set on the website; eri only asks when the
moment makes them relevant.

- **Other connected accounts / which to use for what** (e.g. work Gmail vs personal) — asked the first time eri needs to send something.
- **Calendar / working hours** — asked the first time eri schedules something.
- **People in your life** (partner, team, key contacts) — learned from chatter, never front-loaded.
- **Pronouns** — optional, only if volunteered or set on web.
- **Locale / language & units** — defaulted from timezone, overridable on web.

---

## 3. Data model — where each field lives

Three backing stores already exist. The rule of thumb:

- **Structured, single-valued, server-logic-critical → a real column** (timezone,
  preferred name). The proactive gate and date formatting need to *read these as
  data*, not parse them out of free-text facts.
- **Connections / which-email-to-act-from → `composio_accounts` + one pointer
  column.** eri can only act from connected accounts; the connection table is
  already the source of truth for that.
- **Soft, multi-valued, narrative → `learned_facts`** (role description, people,
  misc preferences). Append-only, merged into the prompt at read time.
- **Distilled rollups → the synced Tier-A `personalization_profiles` blob**
  (communication_style, preference summaries) — written by the laptop, read-only
  from the phone's perspective.

### 3a. Field-by-field placement

| Field | Store | Rationale |
|-------|-------|-----------|
| Preferred name | **NEW `users.preferred_name` column** | Read on every turn to address the user; must be reliable structured data, not parsed from a fact string. Distinct from `users.display_name` (legal/billing/teammate-facing name). |
| Display name | existing `users.display_name` | Already exists; keep as the formal name shown on invoices/teams. |
| Timezone | **NEW `users.timezone` column (IANA, e.g. `Asia/Kuala_Lumpur`)** | The proactive quiet-hours gate currently hardcodes `getUTCHours()` (`app/api/v1/proactive/trigger/route.ts:116`). **This is a real bug for a user in Malaysia** — eri's "quiet hours" run on UTC, so it can text them at 4am local. Must be a column. |
| Locale / units | **NEW `users.locale` column (nullable)** | Defaulted from timezone; small structured datum for date/number formatting. Optional — can defer to a later migration if you want to keep the first migration minimal. |
| Action email pointer | **NEW `users.action_account_id` column** → FKs the chosen `composio_accounts(user_id, toolkit)` row (store the `toolkit` slug, e.g. `gmail`, since that table is keyed by `(user_id, toolkit)`). Plus the connection itself in `composio_accounts`. | "Which email do I act from" is a *pointer to a connected account*, and eri can only use connected ones. The connection lives in `composio_accounts`; the user's default choice is a pointer. |
| Account email | existing `users.email` | The sign-in identity. Explicitly *not* necessarily the action email. |
| Role / what you do | **`learned_facts`** (`kind='fact'`, `source='onboarding'`) | Free-text, narrative, no server logic reads it as structured data. Already merged into the prompt. |
| People, misc prefs | **`learned_facts`** (`kind='fact'` / `'preference'`) | Same as today. |
| Communication style | **`personalization_profiles.communication_style`** (synced) for the distilled rollup; an interim learned `preference` fact is acceptable if set before any laptop sync. | Already the field `buildSystemPrompt` reads (`run_core.ts:20`). |
| Onboarding progress (which of the core-5 are known/asked/skipped) | **NEW `user_onboarding` table** | eri must know what it's already asked so it doesn't re-ask, and what the user skipped so it stops. See §3c. |

### 3b. Migration sketch — `0022_onboarding_fields.sql`

```sql
-- 0022_onboarding_fields — structured onboarding essentials.
--
-- Per-user timezone is the headline: the proactive quiet-hours gate currently
-- runs on UTC (app/api/v1/proactive/trigger/route.ts), which mis-fires for any
-- user outside UTC (e.g. a user in Malaysia gets 4am texts). Timezone must be
-- real structured data the gate can read, not a free-text learned_fact.

alter table users
  -- The short name eri actually calls you (e.g. "Khai"), distinct from the
  -- formal display_name ("Khai Khanna") shown on invoices/teams.
  add column if not exists preferred_name text,
  -- IANA timezone, e.g. 'Asia/Kuala_Lumpur'. NULL = not yet known → callers
  -- fall back to UTC (current behaviour) until set.
  add column if not exists timezone text,
  -- Optional BCP-47 locale, e.g. 'en-MY'. Defaulted from timezone; for
  -- date/number/units formatting. Nullable; safe to defer if you want a
  -- leaner first migration.
  add column if not exists locale text,
  -- Which connected account eri acts from by default. Stores the composio
  -- toolkit slug (e.g. 'gmail'); the connection itself lives in
  -- composio_accounts keyed by (user_id, toolkit). NULL = ask before first send.
  add column if not exists action_account_toolkit text;

-- learned_facts already supports source tagging; onboarding-sourced facts use
-- source='onboarding' so they can be distinguished from chat-learned facts.
-- (No schema change needed — 0021 already has the `source` column.)
```

`users.id` is `text` (`usr_<hex>`), so no type concerns. RLS posture is unchanged —
`users` already has RLS enabled with service-role-only access (`0001_init.sql`).

### 3c. Onboarding progress table — `0023_user_onboarding.sql`

eri must not re-ask what it already asked, and must *stop* once a user has either
answered or declined the core set. A tiny per-field state table is the cleanest way
(append-only `learned_facts` can't express "asked but skipped").

```sql
-- 0023_user_onboarding — per-field onboarding state so eri asks each essential
-- at most once and knows when to stop. Server-owned (RLS on, no policies),
-- same posture as learned_facts / command_queue.

create table if not exists user_onboarding (
  user_id    text not null references users(id) on delete cascade,
  -- one of: 'preferred_name' | 'timezone' | 'action_email' | 'role' | 'comm_style'
  field      text not null,
  -- 'pending' (never asked) is the implicit default (absence of a row);
  -- explicit states: 'asked' | 'answered' | 'skipped'.
  status     text not null,
  asked_at   timestamptz,
  resolved_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, field)
);

alter table user_onboarding enable row level security;
```

State machine per field: absent → `asked` (when eri sends the question) →
`answered` (user gave a value, which is written to its real home in §3a) or
`skipped` (user declined / changed subject twice). Once every core field is
`answered` or `skipped`, eri stops proactively onboarding.

---

## 4. UX flow — surface (a): proactive over iMessage

### 4a. Detecting "I don't know much about you"

eri already loads context per turn in `loadProfile`. Add an **onboarding-gap
check** that runs alongside it:

```
gaps = []
if users.preferred_name is NULL and onboarding.preferred_name not in {answered,skipped}: gaps += preferred_name
if users.timezone       is NULL and onboarding.timezone       not in {answered,skipped}: gaps += timezone
if users.action_account_toolkit is NULL and onboarding.action_email not in {...}: gaps += action_email
if no learned_fact with source='onboarding' kind='fact' about role and onboarding.role not in {...}: gaps += role
# comm_style is normally inferred, not gap-checked; only if explicit-control mode is on
```

A user is "barely known" when `gaps` is non-empty. The order is fixed and
intentional (name → timezone → action email → role), per the progressive-disclosure
research: identity first, then the things that unblock real actions.

### 4b. How many questions per message, and cadence

- **At most ONE onboarding question per message.** (Research rule #2.) Never batch.
- **Never on the very first linked message.** The "You're linked!" reply already
  exists (`REPLY.linked`). The *first real exchange* answers the user's actual
  message first; eri appends a single gentle onboarding ask only if there's a gap.
  Value-first, ≤60s to real conversation (research rule #3).
- **Piggyback, don't interrupt.** Prefer attaching the ask to a substantive reply
  ("...done. quick thing — what should I call you?") over sending a standalone
  setup message.
- **Ask in context when possible.** If the user asks eri to send an email and
  `action_account_toolkit` is NULL, *that* is the moment to ask #3 — it's relevant
  and the payoff is obvious. This beats asking it cold.
- **Rate-limit onboarding asks the same way proactive nudges are gated.** Reuse the
  spirit of `lib/proactive/gate.ts`: at most one onboarding ask per ~24h unless the
  user is actively answering them in sequence (a back-and-forth setup is fine; it's
  *unprompted* repetition that annoys). Respect the existing quiet hours — which is
  exactly *why* timezone (§3b) must be real data.

### 4c. When to stop

- A field is removed from `gaps` permanently once it's `answered` or `skipped`.
- **Two consecutive non-answers = skip.** If eri asks and the user ignores it / changes
  the subject twice, mark that field `skipped` and don't ask again. The user can
  always set it on the website later.
- Once all core gaps are `answered`/`skipped`, eri never proactively onboards again.
  Further enrichment is purely opportunistic via the existing `remember_fact` tool.

### 4d. Capturing answers

Answers are parsed from the user's reply in the inbound turn and written to their
real home (§3a):
- preferred_name / timezone / locale / action pointer → `UPDATE users ...`
- role and people → `INSERT INTO learned_facts (..., source='onboarding')`
- the matching `user_onboarding` row flips to `answered` with `resolved_at = now()`.

This can be done with lightweight tools added to the inbound turn (mirroring the
existing `remember_fact` / `control_computer` tool pattern in
`lib/imessage/inbound.ts`), e.g. `set_profile_field(field, value)` — implementation
left to the engineer; the seam already exists.

### 4e. Handling the two founder nuances over text

**Display name vs preferred name.** eri's ask #1 *explicitly surfaces the
distinction*: it reads the account `display_name` ("Khai Khanna") and offers the
obvious short form ("Khai") as the default, while leaving room for something else.
The answer writes `users.preferred_name`; `display_name` is untouched (it stays the
formal name on invoices/teams). From then on, the prompt's identity line should use
`preferred_name` when present, else `display_name` — i.e. change the line at
`route.ts:190` to prefer `preferred_name`.

**Account email vs action email.** eri's ask #3 *names the constraint out loud*:
"I can only act from accounts you've connected." It tells the user their account
email (`users.email` = bellkaizen@gmail.com) and asks whether to act from that or a
different connected one. If the user names an address that isn't in
`composio_accounts` with `status='active'`, eri responds honestly: "I can't act from
that one yet — connect it on tryeri.ca (or text me and I'll send you the link) and
I'll use it." The chosen, connected account's toolkit is written to
`users.action_account_toolkit`.

---

## 5. UX flow — surface (b): website profile / onboarding section

### 5a. Where it lives

Add a **"Your profile" / "How eri knows you"** section to the existing dashboard.
The account page (`app/(dashboard)/account/page.tsx`) already has the right
component vocabulary (`Section`, `Row`, PATCH `/api/auth/me`). This new section is
about *eri's personalization* (distinct from the existing account/security section),
so it reads best as its own card or a dedicated `/(dashboard)/profile` route in the
`DashboardShell`.

### 5b. Fields shown (mirrors the core 5 + connections)

| Field | Control | Backed by |
|-------|---------|-----------|
| **Preferred name** | text input, placeholder = `display_name` | `users.preferred_name` |
| Display name | existing input (already there) | `users.display_name` |
| **Timezone** | searchable IANA dropdown, **pre-filled from the browser** (`Intl.DateTimeFormat().resolvedOptions().timeZone`) so the user usually just confirms | `users.timezone` |
| **What you do** | short textarea ("a sentence about your work / what you're building") | `learned_facts` (`source='onboarding'`) |
| **Communication style** | small choice (Concise / Balanced / Detailed) + free-text "anything else?" | `personalization_profiles.communication_style` (or interim preference fact) |
| **Connected accounts & "act from"** | list of `composio_accounts`; a radio/"Set as default for sending" on each active one; "Connect another" CTA | `composio_accounts` + `users.action_account_toolkit` |

### 5c. What it looks like (matching the existing design)

- Reuse the `Section` + `Row` pattern, dark-only, lime `accent`, Funnel Display
  headline, `border-white/[0.06]` dividers — visually continuous with the account
  page so it doesn't read as a bolt-on.
- A subtle, **non-blocking** completeness hint at the top: a thin progress line or
  "eri knows: name · timezone · role" chips with the missing ones muted. Framed as
  "the more eri knows, the more useful it is" — never a hard wizard, never a blocker.
- The timezone dropdown defaults to the detected browser tz with a one-line
  "looks like you're in **Asia/Kuala_Lumpur** — change if that's off" so the
  Malaysia case is correct by default.
- The "act from" control sits *inside* the connected-accounts list, with inline copy:
  "eri can only send from accounts you connect here." This is the website mirror of
  text-ask #3 and makes the constraint visible rather than surprising.

### 5d. Persistence

The web section writes to the **same homes** as the text flow (§3a), via API routes
(e.g. extend `PATCH /api/auth/me` for `preferred_name` / `timezone` / `locale` /
`action_account_toolkit`; add a small endpoint for the onboarding-sourced role fact).
Because both surfaces share one backing store, setting timezone on the web instantly
fixes quiet-hours on the phone, and answering "call me Khai" over text shows up
pre-filled on the website. Whichever surface a field is set on, mark its
`user_onboarding` row `answered` so eri stops asking over text.

---

## 6. Implementation checklist (for the engineer)

1. **Migrations:** `0022_onboarding_fields.sql` (`users.preferred_name`,
   `timezone`, `locale`, `action_account_toolkit`) and `0023_user_onboarding.sql`
   (per-field state). Add `source='onboarding'` usage to `learned_facts` (no schema
   change).
2. **Fix the timezone bug:** replace `getUTCHours()` in
   `app/api/v1/proactive/trigger/route.ts:116` with the user's `users.timezone`
   (fall back to UTC when NULL). This is the launch-relevant correctness fix.
3. **Prompt identity line:** in `loadProfile` (`route.ts:190`), prefer
   `preferred_name` over `display_name` for "Your name is …".
4. **Onboarding-gap check + asks:** compute `gaps` per §4a; thread a single ask into
   the inbound turn per §4b–4c; add `set_profile_field` tool(s) mirroring
   `remember_fact` to capture answers (§4d).
5. **Web profile section:** new card/route per §5; extend `PATCH /api/auth/me` and
   add the role-fact endpoint; pre-fill timezone from the browser; surface the
   "act from" choice in the connected-accounts list.
6. **Tests (TDD, ≥80%):** gap detection, one-ask-per-message, stop-after-skip,
   timezone-aware quiet hours, display vs preferred name resolution, action-email
   constraint (refuse un-connected accounts), web↔text store consistency.

---

## 7. Sources

- [Userpilot — AI user onboarding: 8 ways to optimize](https://userpilot.com/blog/ai-user-onboarding/)
- [ProductLed — AI onboarding: activate users in under 60 seconds](https://productled.com/blog/ai-onboarding)
- [GetStream — Chat UX best practices](https://getstream.io/blog/chat-ux/)
- [Raw.Studio — Conversational UX: from chatbots to UX design](https://raw.studio/blog/conversational-ux-from-chatbots-to-ux-design/)
- [Fuselab Creative — Chatbot UI design patterns & best practices 2026](https://fuselabcreative.com/chatbot-interface-design-guide/)
- [UX Design Institute — UX onboarding best practices 2025](https://www.uxdesigninstitute.com/blog/ux-onboarding-best-practices-guide/)
- [Tavus — Starter kit: how to create an AI onboarding assistant](https://www.tavus.io/post/starter-kit-how-create-ai-onboarding-assistant)
- [arXiv 2508.08308 — First Ask Then Answer: supplementary questioning with LLMs](https://arxiv.org/html/2508.08308v1)
