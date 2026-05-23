# Website Cursor-Style Overhaul — Design

**Date:** 2026-05-23
**Surface:** `website/`
**Scope:** Phase 1 = homepage chrome + theme + interactive hero. Phase 2 = other pages.

## Problem

The current site reads as "vibe-coded": 16 stacked sections on the homepage, dark-only `#0a0a0a` background with a single lime accent doing everything. We want Cursor's organizational clarity (cursor.com/home) — simple alternating cards, a real interactive hero, warm tones — applied to eri's existing demos, with our own pastel identity instead of Cursor's neutrals.

## Goals

- Bring homepage from 16 sections down to 9 cleanly hierarchical sections.
- Replace lime-on-black chrome with a sage + lilac pastel palette on warm cream / warm dark, with system/light/dark toggle.
- Build a Cursor-style interactive hero: floating draggable Mac-windows over a brand canvas, with `1 · 2 · 3` tabs that swap between three demo scenes.
- Keep all four existing demos (Hero coffee-shop, EngineRoom, HeroBig prototype, PromptPipeline) — redistribute them into the new layout.
- Drop lime from the chrome but keep it inside the demos. "The engine has its own color."

## Non-goals

- Re-skinning pricing/docs/about pages in this PR (Phase 2; most cascades from `globals.css`).
- Mobile polish on the floating demo windows (Phase 2; Phase 1 ships acceptable, not perfect).
- Inventing new product surfaces — the IDE + CLI + Voice/Gaze + PromptPipeline are the existing surfaces we'll wire up.

## Palette

```
LIGHT MODE                          DARK MODE
─────────────────────────────       ─────────────────────────────
bg            #f7f4ef  cream        bg            #1a1814  warm near-black
bg-card       #efeae0  soft tan     bg-card       #221f19  warm card
border        rgba(42,38,32,.08)    border        rgba(236,232,223,.08)
text          #2a2620  warm ink     text          #ece8df  warm paper
text-sec      rgba(42,38,32,.6)     text-sec      rgba(236,232,223,.6)
accent-sage   #bfd7c1               accent-sage   #a8c4ab  (deeper)
accent-lilac  #cfc4e0               accent-lilac  #b8acd0
focus-ring    #8fb592  sage-700     focus-ring    #b8a8d8  lilac-200
```

- **Sage** = primary identity, focus rings, "active" indicators, primary button.
- **Lilac** = secondary, hover surfaces, decorative chips.
- **Lime (#e0ff4f)** stays only inside demo canvases (PromptPipeline, EngineRoom, HeroBig's prototype). It becomes the engine's color, not the brand's.
- Theme toggle pill (System / Light / Dark) lives in the footer, like Cursor's.

## Homepage structure (9 sections)

| # | Section | Content / source |
|---|---------|------------------|
| 1 | Hero | Headline + macOS download + Request demo + interactive demo card with 3 scene tabs |
| 2 | Logo wall | Existing `LogoWall.tsx`, restyled to cream cards |
| 3 | Feature card A — "Voice + gaze in the editor" | Text left · EngineRoom-style demo right · "Learn about voice + gaze →" |
| 4 | Feature card B — "Diffusion preview, not streaming tokens" | Hero coffee-shop demo left · text right |
| 5 | Feature card C — "Branchable iteration history" | Text left · session-list demo right (built from existing `EriDemo` iteration rail) |
| 6 | Testimonials | 3-column grid, 6 quote cards |
| 7 | "Stay on the frontier" — 3 cards | (a) best model for every task — `ModelMatrix` essence (b) codebase understanding — gaze + grep (c) enduring software — BYOK/local from `Promises` |
| 8 | Changelog teaser | Horizontal scroll, 4 entries, "See what's new →" |
| 9 | CTA footer + FooterBig | "Try eri now" + full footer with theme toggle |

**Retired or folded:** `WhyEri`, `Promises`, `Spotlights`, `ModelMatrix`, `Compare`, `CompareTable`, `Personas`, `PricingTeaser`. Content survives inside the 9 sections; component files stay on disk in case we want pieces back, just unreferenced from `page.tsx`.

## Interactive hero (the centerpiece)

A single brand canvas (rounded warm-dark card, ~720px tall on desktop) with floating Mac-style windows that can be dragged, resized, and reset. A `1 · 2 · 3` tab strip at bottom-left swaps the scene with a crossfade.

### Scene 1 — IDE + Voice Capture *(default, eri's signature)*

- **Big window** (1080×620, z=100): "eri Desktop" chrome.
  - 3-column inside: agent sidebar (In Progress / Ready for Review), main pricing-page preview (the Hero coffee-shop demo, embedded), agent chat panel.
- **Floating overlay** (480×360, z=15): "Voice + Gaze" capture panel.
  - Live transcript line ("make the annual price chip glow"), waveform, gaze indicator pointing to `Toggle.billing-cycle`.

### Scene 2 — IDE + CLI *(Cursor-mirror)*

- Same IDE window.
- Floating overlay (480×360): "eri CLI" — agent transcript ending in a typeable prompt line `→ _`.

### Scene 3 — PromptPipeline *(engine internals)*

- Single wide window (680×560): the existing 5-panel `PromptPipeline` (INPUT/COMPILE/ROUTE/PREVIEW/WHAT CHANGED) animating through its scenes. No floating overlay.

### Window behavior (all scenes)

- macOS chrome: 3 traffic-light dots, centered title, optional right-side button.
- Drag: mousedown on titlebar → drag window. Resize handles on edges + corners (8 total).
- Reset button: bottom-right of canvas, snaps all windows back to their default positions.
- Crossfade between scenes (200ms opacity).

### Send behavior (the conversion gate)

**IDE chat (Scene 1 + 2):**
1. User types in the chat textarea.
2. On Enter or Send click: message gets appended to the conversation thread.
3. After 600ms: assistant reply is inserted — canned line + download link:
   > *"This needs the real eri running locally."* &nbsp; **Download eri →**
   The link goes to `/download`.
4. Input clears, ready for another go.

**CLI (Scene 2):**
1. User types in the prompt line — input echoes live.
2. Typing `/` opens a command palette dropdown: `transcript`, `gaze`, `diffuse`, `agent`, `models`, `history`, `clear`.
3. Enter does **not** submit. Input clears (or shakes briefly). No agent response.
4. Titlebar shows a "Get eri" link on hover → `/download`.

Every action that *feels* like submitting eventually points users at download — the demo converts.

## Header / Footer

- **SiteHeader**: fixed top, warm-bg, 3-column grid (logo / centered nav / actions). Nav items: Product (flyout), Enterprise, Pricing, Resources (flyout). Right side: Sign in, Contact, Download.
- **FooterBig**: 5-column nav grid (Product, Resources, Company, Legal, Connect), bottom bar with copyright + SOC2 + theme toggle pill + language stub.

## Components — file plan

```
website/app/globals.css                  edit  ← new palette tokens
website/app/page.tsx                     edit  ← 9-section flow

website/components/Hero.tsx              rewrite to interactive demo
website/components/hero/HeroCanvas.tsx   new
website/components/hero/HeroWindow.tsx   new (draggable Mac window)
website/components/hero/SceneTabs.tsx    new
website/components/hero/IDEWindow.tsx    new
website/components/hero/VoiceWindow.tsx  new
website/components/hero/CLIWindow.tsx    new
website/components/hero/PipelineWindow.tsx  new (wraps PromptPipeline)

website/components/FeatureCard.tsx       new (generic text+demo card)
website/components/SiteHeader.tsx        edit
website/components/FooterBig.tsx         edit

website/components/{WhyEri,Promises,Spotlights,ModelMatrix,Compare,
  CompareTable,Personas,PricingTeaser}.tsx   unreferenced, kept on disk
```

The hero is split into small files so each window has one clear purpose and can be edited independently — same reason Cursor's site has dozens of small chunked components.

## Testing

- Visual smoke: load `/`, confirm all 9 sections render in light + dark + system modes.
- Hero demo: scene tabs cycle, windows drag, IDE chat funnels to /download, CLI commands palette opens, reset button works.
- Theme toggle: footer pill switches html `data-theme` attribute, palette swaps instantly.
- Build: `next build` must pass (no breaking imports from retired components).

## Open risks

- **Mobile**: floating-windows pattern doesn't translate cleanly to small screens. Phase 1 fallback: under `md` breakpoint, show a single stacked static preview instead of draggable windows. Polish in Phase 2.
- **Lime/sage clash inside demos**: if the chrome is sage and the demos are lime, the seams might look jarring. Mitigation: give each demo a warm-dark inner background so they read as "screens within a screen" — the lime stays contained.
- **Retired components leaving dead code**: leaving them unreferenced is intentional (cheap to revive), but if we cut another PR before Phase 2 we should delete them.
