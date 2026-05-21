# Landing Inspiration Notes

Research compiled from kiro.dev, cursor.com, warp.dev, qoder.com/desktop, bob.ibm.com.
All findings are structural / pattern observations — original copy and visuals will be authored for eri.

## Common structural DNA across the field

1. Big-type hero with a single italic/shimmer phrase that carries the value prop.
2. Two CTAs (primary accent + ghost) directly under the subhead.
3. An above-the-fold or just-below-fold *interactive product mockup* — never a static screenshot. Cursor and Kiro both embed an animated UI mock, not a video.
4. Three to five spotlight sections, each anchored by a single visual + a short headline + a one-sentence support line.
5. A comparison block (Cursor + Kiro both use feature tables to position against incumbents).
6. Quote-card testimonials in a row of three.
7. Big italic CTA finisher on accent background.
8. Notion-style multi-column footer.

## Hero anatomy

- Headline 4rem–8rem, line-height ~0.95, letter-spacing tight.
- 1 italic word with gradient shimmer (Cursor, ChatGPT, Linear all do this).
- 1–2 line subhead beneath, ~1.125rem, secondary text color.
- Two CTAs: lime/accent primary (6px radius) + bordered ghost.
- Tiny "trusted by" or "used by builders at" logo row directly under CTAs.
- Background: mesh gradient (low-opacity radial blobs) + grain texture at 5–8% opacity. The grain is what makes it feel filmic rather than corporate.

## Interactive demo embed (the differentiator)

Both Cursor and Kiro give the demo its own full-bleed section. Pattern:

- Window chrome (traffic lights, title bar) wraps the demo in a "fake browser/IDE" frame.
- Three columns: left rail (file tree / history), center (preview / editor), right rail (chat / agent panel).
- Animations run on a loop every 10–14 seconds.
- Inside the right rail, you see: input → loading state → resolved state. This three-beat rhythm is what makes it feel alive.
- Cursor specifically shows a model picker dropdown in the editor chrome — that's the moment that signals multi-model.

For eri, the right-rail beats become:
1. Voice waveform (live SVG bars).
2. Transcript types out letter-by-letter.
3. "Mercury 2 — denoising…" with animated dots.
4. ✓ ready.

And the center pane builds an HTML page section-by-section in sync.

## Section order (synthesized from Kiro + Cursor)

1. Header (sticky, blur backdrop, hairline border-bottom).
2. Hero.
3. Logo strip (small, secondary).
4. Big interactive demo (full bleed, ~100vh).
5. 3–4 spotlight sections, alternating left/right layout.
6. Comparison table (the "vs Cursor / v0 / Bolt / Lovable" wedge).
7. Personas (3 cards).
8. Pricing teaser (3 cards, link out to /pricing).
9. Testimonials (3 quote cards).
10. CTA footer (accent gradient, oversized italic).
11. Footer (4 columns).

## Animation patterns observed

- Scroll-triggered fade-up on section enter (12–16px translate).
- Always-on micro-animations: waveform bars, denoise blur cycle, pulse dot, shimmer text.
- Hover lift on cards (translateY(-2px) + border lighten).
- Loop animations gated to 10–14 second cycles, not faster — fast loops feel busy.

## Color palettes observed

- Cursor: near-black with warm neutrals, single accent.
- Kiro: light-on-dark with purple accent.
- Warp: cool gray with electric accent.
- Common thread: ONE accent color, used sparingly. Never two competing accents.

For eri we keep: `#0A0A0A` ink + `#F5F2EC` paper + `#E0FF4F` lime accent. Same DNA.

## Typography pairings

- Cursor: Inter + a serif for italic accents.
- Kiro: sans for everything, weight contrast for hierarchy.
- Linear: Inter Display + mono caps for labels.

For eri we keep: Fraunces (display serif, used italic for shimmer phrase) + Space Grotesk (body) + JetBrains Mono (labels and code).

## Copy tone observations

- Imperative verbs ("Bring", "Build", "Ship").
- Short sentences. Often a comma replaces the conjunction.
- Concrete numbers in the support copy ("under 2 seconds", "in minutes").
- One italic word per headline carries the emotion.
- Sub-headlines describe the *outcome*, not the feature.

## Wedge for eri vs. the field

- Cursor + Kiro both target professional engineers in big IDEs.
- v0 + Bolt + Lovable target prompt-to-app for non-coders.
- eri sits in the gap: voice-first + diffusion-fast + native macOS for indie founders who want to *talk* their build into existence.
- The comparison table is the most important section because nobody else does voice + diffusion + multi-model routing in one surface.

## Component plan

- `SiteHeader` — sticky, blur, accent download button (already exists, refine).
- `Hero` — new oversized version with italic shimmer.
- `LogoStrip` — small mono-cap logos.
- `EriDemo` — new centerpiece. Three-column animated mock. Loops every 12s.
- `SpotlightSections` — four alternating sections (voice / diffusion / routing / cloud).
- `CompareTable` — sticky-header feature comparison.
- `Personas` — three cards.
- `PricingTeaser` — three cards linking to /pricing.
- `Testimonials` — three quote cards (already exists, refine).
- `CtaFooter` — accent gradient finisher (already exists, refine).
- `Footer` — 4-col Notion-style (already exists, refine).
