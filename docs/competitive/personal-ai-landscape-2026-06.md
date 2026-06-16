# Personal-AI competitive landscape — June 2026

Teardown of nine personal-AI / "AI in your texts" / agentic-assistant products, and where **eri** wins.
Research date 2026-06-15 (4 parallel research passes). Funding/traction figures are third-party and
flagged where uncertain; aggregator data is polluted by name collisions for several (Tomo, Orchid,
Ollie, Lucas) — site copy treated as authoritative.

> **eri** = "the AI operating system for a person" (Eri Labs). One brain across iMessage/phone +
> computer + IDE, cross-device bi-temporal memory, sees your screen (gaze/vision) + hears you (voice),
> controls your **own** computer hands-free, token-frugal hosted brain (Claude escalation only for hard
> work), per-user personalization, invisible tool use, proactive.

---

## The one-paragraph strategic read

Every credible competitor has converged on the **same three things**: a **messaging-native presence**
(iMessage/SMS), **proactivity** ("texts you first"), and **frictionless onboarding** (text a number, no
app). That trio is now **table stakes** — eri cannot launch the phone wedge without it. Where they
**diverge and stay weak** is exactly eri's whitespace:

- **Computer control** — Lindy drives a *detached cloud VM*, Lucas a *sandboxed browser*, Zo a *rented
  remote Linux box*. **None control the user's own machine**, with real logged-in sessions and native
  apps, hands-free via **gaze + voice**. This is eri's uncontested moat.
- **Memory** — everyone *claims* it; almost all are shallow (Poke summarizes ~every 100 msgs; Lindy has
  **no disclosed long-term memory**; Folk = a CRM timeline; Ollie = family prefs; Orchid/Lucas
  undisclosed). Only **Sauna** is architecturally deep (dual memory) — but it's cloud/team/$99-floor.
  **None have true cross-device, cross-surface, bi-temporal personal memory.** eri already ships this.
- **Pricing** — the category is bleeding on cost: Lindy's **credit-burn** backlash (agents *pause
  mid-task*; a phone call ≈265 credits), Sauna's **$99/mo floor**, Folk's aggressive paywalls, Poke's
  negotiated/subsidized pricing. eri's **token-frugal tiered router** (fast-lane → local Qwen → Claude
  only for hard work) is a structural cost advantage — if presented as *predictable*, not metered.
- **Trust/safety** — **nobody publishes a security posture**; prompt-injection via ingested email is
  the category's #1 unaudited risk; Lindy literally **sent emails to the wrong recipient 3×**. eri's
  `action_log.rs` + honest undo + `control_safety.rs` (sensitive-action refusal, cancellation,
  injection-resistant boundaries) is a real head start.

**No single competitor holds more than two of:** *local hands-free control of your own machine · deep
cross-device bi-temporal memory · voice+gaze input · predictable token-frugal pricing · visible
trust/undo.* eri's job is to be the one that holds all five — and to **ship the proactive iMessage loop
(the gate) and one screenshot-worthy hands-free demo (the hook)**.

---

## Comparison matrix

| Product | Category | Primary surface | Computer control | Memory depth | Proactive | Pricing | Traction (unverified) |
|---|---|---|---|---|---|---|---|
| **Poke** (Interaction Co) | AI in your texts | iMessage/SMS/WA/TG | ✗ (text-only) | shallow (~100-msg summaries) | ✓ strong (pre-meeting briefs) | negotiated $0–$30+ | $15M seed→~$300M A; ~6k insiders |
| **Lucas** (meetlucas.ai) | "Texts you first" | iMessage/WhatsApp | ◑ **browser agent + live takeover** | undisclosed | ✓ | undisclosed | tiny team; opaque |
| **Sauna** (Wordware) | AI coworker (multiplayer) | web/iOS/iMessage/Slack/Superhuman | ◑ browser (remote, $999 tier) | ✓✓ **dual memory** | ✓✓ always-on cloud | **$99/$299/$999** | $30M seed; pivot, no own traction |
| **Tomo** (Mapo Labs) | Accountability companion | iMessage (no Android) | ✗ | goal memory | ✓✓ (texts first) | sub, non-refundable | claims 250k (conflicting) |
| **Zo Computer** | Personal cloud computer | web/desktop + messaging | ◑ **own cloud Linux box** (root) | files (`Agents.md`), weak in-session | ◑ scheduled | $18–$200/mo + credits | Lightspeed seed; eng buzz |
| **Orchid** (YC S25) | EA in your iMessage | iMessage/SMS | ✗ (approval-gated tasks) | "second brain" (undisclosed) | ✓ morning brief | undisclosed | ex-Zero/0.email audience |
| **Lindy** | No-code AI employees | web/iMessage/**phone (Gaia)** | ✓✓ **Autopilot cloud VM** | ✗ KBs only | ✓ multi-trigger | credit-burn $50–$200 | ~$50M; G2 4.9/Capterra 3.5 |
| **Folk** | Intelligent CRM (xRM) | web + Chrome ext (no mobile) | ✗ | per-contact CRM timeline | ◑ 4 always-on assistants | $20–$80/seat | ~$8.3M ARR; ~100k users |
| **Ollie** (Confabulation) | Family AI | iMessage/SMS group + app | ✗ | per-family prefs | ✓✓ briefings, next-steps | free beta → ~$10/mo | Khosla/AI2; ~90k users |
| **eri** | AI OS for a person | **iMessage + computer + IDE** | ✓✓ **own machine, gaze+voice** | ✓✓ **cross-device bi-temporal** | ✓ proactive.rs | **token-frugal tiered** | pre-launch |

◑ = partial / remote-only.  ✗ = absent.  ✓✓ = category-leading.

---

## Per-company highlights (the parts worth remembering)

- **Poke** — category leader by *distribution disguised as features*: the negotiate-your-own-price
  "bouncer" onboarding (viral on X), a **personality/execution agent split** (sassy voice, reliable
  task machines), and a **creator economy paying $0.10–$1 per recipe signup**. Already cloned
  (OpenPoke); moat is distribution + the Apple relationship, not tech.
- **Lucas** — the *most ambitious* feature surface: auto-detects deadlines in email, a **real browser
  agent you can watch / take over live**, in-thread songs/videos/memes, builds & publishes a website
  from a text. Very early, opaque, feature-sprawl + reliability fixes.
- **Sauna** — eri's **closest architectural competitor**: learns you, dual memory, always-on, acts
  across iMessage/Slack/Superhuman. But cloud-always-on, team-multiplayer, model-agnostic, $99 floor.
  Validates the entire thesis; leaves the local/private/token-frugal/own-device lanes open.
- **Tomo** — text-native accountability with strong **proactive check-ins** and **personality as the
  retention driver**. Narrow, iMessage-only, opaque, trial-to-paid trust friction.
- **Zo Computer** — your own always-on cloud Linux box + agent; **container "time-travel" rollback** is
  a great trust UI to emulate. It's not *your* machine, though.
- **Orchid** (the Zero/0.email team's pivot) — "EA in your iMessage": morning brief, draft-and-approve,
  evocative recall. Structurally fragile (iMessage-only, no business API), trust surface unaddressed.
- **Lindy** — most direct threat: **Autopilot computer-use** ("the last integration you'll ever need"),
  **Gaia** sub-second voice phone agent, agent swarms, Claude-default. But cloud-VM, **no real memory**,
  and bleeds trust on reliability (**wrong-recipient emails**) + credit burn.
- **Folk** — intelligent CRM with **four always-on assistants** (follow-up in your tone, Perplexity
  research, recap, workflow) and **MCP-exposed enrichment**. Vertical, no mobile, weak automation.
- **Ollie** — **Family AI** in the group chat: shared family memory, morning briefings, conditional
  reminders, CV pantry scanning, one-tap grocery delivery. Wedged on meals; US/mobile-only.

---

## Steal-list — best ideas worth adopting (eri-flavored)

1. **Proactive outbound briefings** (Poke/Lucas/Orchid/Ollie) — pre-meeting briefs, morning summary,
   auto-detected deadlines from email → an *outbound* iMessage. Anti-annoyance gated.
2. **One-tap draft-and-approve "in your voice"** (Orchid/Lindy/Folk) — pairs perfectly with the new
   `communication_style` mirroring + `action_log`/undo.
3. **Visceral rollback UI** (Zo "time-travel") — make eri's honest undo *visible and reversible-feeling*,
   not just a CLI flag.
4. **A viral, screenshot-able onboarding moment** (Poke's price bouncer) — eri's version = a live
   hands-free gaze+voice desktop task nobody else can show.
5. **Personality as retention** (Poke/Tomo) — the new `HUMAN_VOICE` persona + register-mirroring is
   exactly this; lean in.
6. **"Tag me in-context"** (Sauna/Superhuman) and **personality/execution agent split** (Poke) — clean
   patterns for the multi-surface + builder/checker architecture eri already has.

---

## What eri must ship to win — prioritized (do NOT build all of it)

Triaged to the wedge. Three things matter; the rest is steal-list polish.

### P0 — The gate: proactive iMessage loop
Every rival's core wedge. eri has the *suggestion* model (`proactive.rs`, "after X you usually Y") but
not the **email/calendar-triggered outbound text** on the phone surface. Ship: background trigger
(urgent email / upcoming meeting / detected deadline) → anti-annoyance-gated outbound iMessage → optional
one-tap approve. Reuses the phone tier (Sendblue, two-tier memory). **Without this, the phone wedge
can't launch.**

### P0 — The hook: one reliable, screenshot-worthy hands-free demo
eri's uncontested moat is controlling the user's **own** machine via **gaze + voice** — Lindy/Lucas/Zo
can only drive a *remote* browser/box. Make ONE end-to-end task rock-solid and demoable (gaze at a
field, speak, eri acts in the real app). This is the viral moment + the category-defining difference.
Reliability beats Lindy's #1 complaint (autonomous actions going to the wrong place).

### P1 — The headline: cross-device bi-temporal memory, made visible
The clearest open lane — no competitor has true cross-device, cross-surface, bi-temporal memory. eri
*ships* it (contradiction/supersession, MMR recall). Productize the demo: **something said on the phone
surfaces on the computer** (and vice-versa). Make memory inspectable to build trust. Stop burying it.

### Always-on framing (not a build, a positioning rule)
- **Token-frugal = predictable pricing.** Never pause a task mid-flow for credits (Lindy's wound). Sell
  "most actions cost zero cloud tokens," not metered-per-action.
- **Trust is a feature.** eri is the only one that can publish a real safety posture (sensitive-action
  refusal, injection-resistant boundaries, visible undo). Make it loud — the category's #1 unaudited
  risk is exactly here.
- **Voice latency is table stakes.** Lindy's Gaia proved sub-second phone-agent latency is expected;
  eri's local voice/gaze stack must match conversational latency.
