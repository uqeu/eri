# eri — Claude.ai Artifact prompt (paste-ready, v2)

Paste the box below into a new chat at **claude.ai**. Claude can't browse the inspo links, so
the prompt describes what to steal — keep the links open while you steer it.

---

```
You are a world-class product designer and front-end engineer with exceptional taste. Design and
build the marketing homepage for a product called eri as a single, self-contained, production-
grade Artifact (React + Tailwind in the artifact runtime, OR one HTML file with Tailwind + vanilla
JS — whichever lets you go further). This should look like the most beautiful launch page of the
year, not a template. Be ambitious. Take real swings. The bar: a visitor should ask "how did they
make this?", never "which AI made this?"

==================================================
WHAT ERI IS (say it plainly, like a friend would)
==================================================
eri is a personal companion that runs your computer. You text it (iMessage), talk to it, or just
let it watch your screen. It books the dinner, fixes the deck, writes the code, clears the
busywork — right there on your Mac. It remembers how you work. One mind across your computer and
your phone: start a task at your desk, finish it on the go. Tagline in play: "the friend who runs
your computer."

==================================================
ERI'S REAL INTERFACE — THE HERO VISUAL (build this, make it gorgeous)
==================================================
eri's actual app is a floating, translucent GLASS overlay that lives on top of your screen — like
Cluely, but more beautiful. It is the centerpiece of the page. Build it for real:
- A frosted-glass, semi-transparent panel (heavy backdrop-blur, subtle saturation, a fine inner
  light border/highlight, a soft outer glow, gentle shadow). You can see the desktop through it.
- It MORPHS. It starts as a small compact pill/orb floating in a corner, then fluidly expands into
  a wider panel when eri is doing something — showing what it sees on your screen, the steps it's
  taking, and the answer — then settles back. Animate the morph (width/height/shape) with smooth
  ease-out curves; it should feel alive and physical, like liquid glass.
- Stage it over a real-feeling desktop scene (a blurred colorful macOS wallpaper, a couple of app
  windows, a menu bar) so the transparency reads. The glass picks up the colors behind it.
- This is glassmorphism done on purpose because it IS the product — lean into it; make it the most
  beautiful thing on the page. (This is the one place glass is not a cliché: it's the real UI.)

Show a tight loop in the overlay: eri notices something on screen → expands → "the deck's missing
the Q3 numbers — want me to pull them in?" → does it → collapses back to the pill.

==================================================
THE VOICE (most important thing — must NOT sound like an AI product)
==================================================
eri sounds like a sharp, warm, slightly dry friend who happens to run your computer. Study how
people actually text.
- Lowercase, casual, short sentences. Second person ("you", "your").
- Concrete verbs and real scenarios ("books the dinner", "fixes the deck"), never capability-speak.
- Human, lifestyle benefits, sometimes quantified: "less admin, more life", "save a few hours a
  week", "more nights like this".
- Light emoji in chat demos only (✅ 👍 ❤️). A character with personality: "on it.", "say less.",
  "wait already?? yes please", "done — texted sam to lock it in."

BANNED WORDS (never use): AI, intelligence, "personal intelligence", system, "operating system for
your life", adaptive, agent, "powered by", seamless, unleash, supercharge, elevate, empower,
harness, effortless, "gets things done", revolutionary, next-gen, cutting-edge, "the future of".
Also: NO em dashes in copy. NO gradient-on-text. NO fake metrics/logos/testimonials (pre-launch
private alpha, zero users). NEVER the literal word "AGI".

==================================================
DESIGN DIRECTION (beautiful, rich, alive — never bare, never the AI default)
==================================================
Commit to a real aesthetic with color, depth, motion, and life. AVOID the saturated 2026 AI-
default look, which reads as bland/AI instantly:
- no beige/cream/"paper" backgrounds as the safe move
- no italic display-serif accent word (the Instrument-Serif/Fraunces cliché)
- no tiny uppercase tracked eyebrow above every section
- no repeated identical 3-up icon+title+text card grids
- no vast empty white space passed off as "minimal"

Instead:
- COMMIT to a palette with a real accent that carries the brand (warm coral, electric green, deep
  ink + one glow color — your call, but commit; color is voice). The page should have a mood.
- Depth + composition: layered soft shadows, ambient gradient glows, device mockups that float
  among "moment" cards (a calendar event eri just added, a "booked & texted Sam ✅" toast, the
  cluster of app icons it touched). Density and life, not lone elements on white.
- Intentional motion as a first-class material: the glass overlay morphing, the chat threads
  typing live, gentle float on cards, scroll-reveals that fit what they reveal, smooth ease-out
  (no bounce). Honor prefers-reduced-motion.
- Pixel-care: real contrast (dark-enough body text), consistent radii, tuned spacing rhythm.

==================================================
SIGNATURE SECTIONS (make each excellent)
==================================================
1. HERO — the morphing glass overlay (above) over a desktop scene IS the hero. Headline: "the
   friend who runs your computer." Bold, tight tracking. Human subhead. One CTA: "text eri".
2. ON YOUR PHONE TOO — a faithful iOS Messages thread in a clean iPhone frame (dynamic island,
   blue/gray bubbles, typing dots, a tapback heart, "Read" receipt, input bar), auto-playing:
     you: book a table for two friday, somewhere good near me
     eri: on it.
     eri: rintaro, 7pm — 4.8★, 6 min away. booked it and texted sam to lock it in.
     you: you're the best   (eri hearts this)
   Float moment-cards around it.
3. TAKE IT ON THE GO — show the same eri on the Mac (the glass overlay) and on the phone, as a
   draggable comparison wipe (clip-path) OR a satisfying auto-morph between the two devices. At
   rest it should clearly read as one device; revealing the other should feel great. Story:
   "start it at your desk. finish it on the go." (ref: 21st.dev comparison component.)
4. RANGE as real moments (not a feature grid), one scene each in eri's voice: text it · it watches
   your screen and helps in real time · it writes/fixes code · it gets ahead of you ("your 2pm —
   the deck's missing the Q3 numbers, want me to add them?").
5. INTEGRATIONS — a tasteful marquee/cluster of everyday apps eri touches (Messages, Calendar,
   Mail, Maps, Notion, Slack, GitHub, Spotify…). Implies reach.
6. CLOSING CTA + footer, all in eri's voice. CTA "text eri". Honest: "private alpha · macOS".

==================================================
INSPIRATION — study how beautiful these are; steal the moves
==================================================
- Poke (https://poke.com/) — friend-first personal AI over iMessage; warm, playful; sticky animated
  phone mockups; integration carousels; "Message Poke".
- Series (https://series.so/) — sleek, premium, minimal personal-AI-over-iMessage; glassy, refined.
- Orchid (https://orchid.ai/) — dark twilight palette + lifestyle warmth + emoji; aspirational mood;
  iMessage hero; "say less."
- Folk (https://www.getfolk.app/) — "the friend in your texts that gets stuff done"; clean,
  restrained, beautifully polished iPhone mockups; lowercase; quantified human benefit.
- Lucas (https://meetlucas.ai/) — colorful (purple), real lowercase texting dialogue, scenario
  tiles; "Text Lucas".
- Tomo (https://www.tomo.ai/) — dark + pastel gradient orbs, playful, lifestyle "live your life to
  the fullest".
- Zo (https://www.zo.computer/) — clean, ownership-led, confident; interactive showcases.
- Lindy (https://www.lindy.ai/) — soft pastel modern, clear capability storytelling.
- Sauna (https://www.sauna.ai/) — problem→solution narrative, product mockups, playful close.
- Ollie (https://ollie.ai/) — warm family "mental load / invisible workload" framing; group chats.
What they share: a committed accent + mood, real device/product mockups, soft depth and glow,
smooth motion, lifestyle warmth, a named character, and the conversation/product shown live.

==================================================
TYPE & TECH
==================================================
- Fonts: a clean modern sans with character (Geist is good; avoid Inter-default blandness and the
  italic-serif accent cliché). Mono only inside device/overlay UI.
- One self-contained artifact. Fully responsive (nail mobile). Smooth and fast. Prefer rendered UI
  / CSS / inline SVG over external images you can't verify (no broken-image placeholders).
- Accessibility: contrast, keyboard focus, prefers-reduced-motion fallback.

==================================================
DELIVERABLE
==================================================
One stunning, complete, scrollable homepage. The morphing glass overlay is the showpiece — make it
jaw-dropping. Every word in eri's voice. Beautiful, rich, alive, unmistakably not-a-template. When
done, note the 2-3 boldest choices you made so I can push them further.
```

---

## How to use it
1. Open **claude.ai**, paste the box. It builds a live Artifact you can scroll.
2. Steer: *"make the glass overlay bigger and morph slower"*, *"more coral, more glow"*, *"redo the
   comparison as an auto-morph"*, *"the code moment looks generic — make it real."*
3. When you love a version, bring it back here and I'll port it into the real Next.js site (fonts,
   live demos, `/download` + `/connections`, deployed).
