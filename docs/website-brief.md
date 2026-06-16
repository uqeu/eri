# eri website — build brief (for a fresh Claude session)

Hand this to a new Claude Code session opened in `~/Desktop/eri` (the website lives in
`website/`, Next.js). It is self-contained. Read the linked memories + CONTEXT.md first.

## What eri is (positioning — frame everything to this)
- **eri = the AI operating system for your life.** Company = **Eri Labs**.
- Tagline/mission: **"Adaptive personal intelligence empowering everyone to live smarter, more
  fulfilled lives."**
- An adaptive personal intelligence that connects to all your apps + devices, sees your screen,
  hears your voice, remembers you, and *does* your digital work hands-free across computer +
  phone — and gets more *you* over time (each person trains their own eri). It does the work
  (outcome), it doesn't hand you a tool. Memory + connectors + voice + gaze + own-brain = one
  brain for your whole life.
- **NEVER say literal "AGI"** in copy (legal + credibility). Say "adaptive personal
  intelligence." Pre-launch alpha → **no fake testimonials, no invented SaaS metrics, no fake
  user counts.** Lead with what it does + the vision.

## Design system (canonical — confirm against the live site)
- **Dark-mode ONLY.** No theme toggle. No pastel accents in the chrome. (memory:
  [[feedback_clean_dark_mode_only]])
- **One accent: lime** — reserved for the engine/demo moments, not splashed across chrome.
- **Display font: Funnel Display (Google Fonts)** — NOT a serif, NOT Fraunces. (memory:
  [[project_eri_typography]]. Early "visual language" notes said "serif headlines" — that's
  outdated; defer to Funnel Display + whatever the live site currently uses.)
- **Logo:** the wordmark is the text "eri" with -0.05em letter-spacing in the display font;
  PNGs exist as fallback but the text is canonical. (memory: [[project_eri_logo]])
- **Aesthetic north star:** editorial/schematic — the "architecture-report" look — + Warp-style
  depth + pointer.ai-style product demos; restrained palette; schematic diagrams. Be visual but
  clean. (memory: [[feedback_eri_visual_language]])

## Structure / pages
- **Homepage** = ONE **Control/Build morphing glass pad** (NOT six stacked rows). Positioning:
  two modes of one brain (research folded into Control). Verified to match the app. Sections:
  Hero + the morph pad + CapabilityPillars + chapters. (memory: [[project_homepage_morph_pad]])
  - Now that positioning is "**the AI operating system for your life**," the hero should lead
    with that line + the adaptive-personal-intelligence framing (update older copy to this).
- **/download = the front door** (3-step: 1. download → 2. login & sync → 3. hotkey). Hands-free
  quickstart. (memory: [[project_website_onboarding]])
- **/connections** (dashboard) — already expanded to 23 connectors, grouped (gmail, calendar,
  drive, docs, sheets, outlook, contacts, notion, slack, discord, telegram, github, linear,
  jira, asana, trello, clickup, todoist, calendly, hubspot, twitter, linkedin, dropbox). Connect
  via Composio hosted OAuth. Pro+ gated. (LIVE — don't break it.)
- Keep the existing dashboard/auth/usage pages.

## HARD constraints (don't break things)
- **Do NOT remove or restyle existing eri panels** (mcp, checkpoints, codemaps, etc.) or touch
  the VSCodium workbench shell. (memory: [[feedback_no_panel_loss]]) Website scope = marketing
  site + dashboard, not the IDE shell.
- Keep it dark-only. Keep Funnel Display. Keep the morph-pad homepage concept.
- CSP already allows fonts.googleapis.com (don't regress).

## Tech + verification
- Stack: Next.js + Supabase, in `website/`. Deploy = push to main → Vercel (prod = tryeri.ca).
- **Green gate before declaring done:** `npx tsc --noEmit` clean + any website tests pass.
- **Verify visuals by headless screenshot — don't iterate blind:** screenshot localhost:3100
  with Remotion's chrome-headless-shell. (memory: [[reference_headless_screenshot]])
- Use the `impeccable`/headless-screenshot skills if available; match the existing component
  patterns + Tailwind tokens already in `website/`.

## Suggested build tasks (the new session should plan, then execute green-gated)
1. **Re-anchor the homepage hero + copy to the new positioning** ("The AI operating system for
   your life" / adaptive personal intelligence) — keep the morph pad; refresh the headline,
   subhead, and CapabilityPillars language to the OS-for-your-life story.
2. **Polish /download** (the front door) — make the 3-step crisp + the hands-free quickstart
   obvious; ensure it's the primary CTA path.
3. **Tighten the visual system** to the editorial/schematic + Warp-depth direction; lime only on
   the demo moments; consistent Funnel Display type scale; dark-only.
4. **A real product demo on the homepage** (pointer.ai-style) showing eri acting hands-free
   (screen/voice → it does the task). Use a recorded/synthetic demo, not fake metrics.
5. Screenshot-verify every change at localhost:3100; tsc + tests green; then push to Vercel.

## eri "Flow" layer — beat Wispr Flow (show on the site + it's a real product surface)
eri is also a best-in-class voice/dictation/flow tool (talk to it, it captures/cleans/acts, and
shows you your patterns). The website should present these as first-class features; the product
builds them (SOTA on-device STT + eri's own model for cleanup/format/tone). Feature surface:
- **Dictation everywhere** — speak into any app; real-time auto-cleanup (filler/grammar/punct),
  tone + format modes, app-aware formatting.
- **Quick-capture → eri notes** — call up eri, dictate something fast, it lands in eri notes.
- **Voice commands, custom dictionaries, snippets / style transforms** (text expansion).
- **Insights dashboard (privacy-respecting, local aggregation):** total words dictated, WPM,
  fixes made, time saved, streaks, desktop usage, what you use eri for, AI prompts, tasks,
  personal/work messages, emails, documents, dictionaries, snippet transforms.
- **"How to use eri"** guide surface (discoverability of all capabilities).
- Positioning vs Wispr: Wispr is dictation; **eri dictates AND acts AND learns you** — the flow
  layer is one feature of the personal OS, not the whole product.
- A SOTA-STT + better-than-Wispr build plan is being researched (agent a51b1a4cceb949967) and
  will land in [[project_composio_brain_execution]] / a flow-layer doc — the website session
  should reflect the final feature list from there.

## Don'ts (recap)
No "AGI" in copy · no fake testimonials/metrics/user counts · don't touch the IDE/VSCodium shell
or existing panels · don't add a light/dark toggle · don't switch off Funnel Display.

## Pointers in the repo
`website/` (the app), `website/app/(dashboard)/connections/page.tsx` (live connectors),
CONTEXT.md, docs/architecture/. The brain/corpus/connector work is tracked in
[[project_composio_brain_execution]] — the website just needs to *tell that story*, not rebuild it.
