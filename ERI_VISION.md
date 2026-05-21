# eri — Strategic Positioning

> A voice-driven AI IDE. Hard fork of Zed. Sub-2s edits via Mercury 2 diffusion, local voice (Whisper), TTS (ElevenLabs), a 1B-param "brain" for acknowledgements (Llama-3.2-1B via MLX), gaze targeting, in-IDE live preview, project persistence, iteration scrubber, and a "ship it" handoff to Claude Code CLI for polish + Vercel deploy.

---

## 1. What YC Funds in This Space

YC has fully repositioned around AI-native dev tools. W26 alone has ~39 developer-tool/agent companies — the densest category in the batch (Extruct AI; Sameer Nanda batch analysis). Across 2024–2026 the recurring patterns YC partners back are:

- **Autonomous coding agents that ship PRs.** Cognition's Devin (not YC, but the reference point), and YC-funded **Emergent** ($50M ARR in 7 months by generating, testing, and deploying apps from plain-language intent) define the upper bound.
- **Vibe-coding app builders for non-engineers.** **Lovable** ($100M ARR in 8 months, $6.6B valuation), Bolt.new, v0. Lovable is *not* YC; Replit is YC (S08, recently raised at $9B). The pattern YC wants is "anyone can ship a working app" — non-engineer TAM.
- **Agent infrastructure.** Sandboxes (Runtime), reliability (Sentrial), self-healing (Sonarly), evaluation (Canary, ashr). YC W26 is heavy on the *substrate* under coding agents.
- **Speed and cost wedges.** Mercury 2 itself (Inception Labs, not YC) — $0.25/$0.75 per M tokens, 1000+ tok/s — is the kind of "10x primitive" YC partners love when wrapped into a product story.

What YC partners pattern-match on: (a) non-obvious distribution insight, (b) defensible primitive (a model, latency, modality, or data loop competitors can't trivially copy), (c) demo that makes the room gasp in <60 seconds, (d) a wedge that expands into a category. eri has three of the four; #3 is the one to nail.

**No YC company today is voice-first IDE.** Vocode and Vogent are voice-agent infra, not IDEs. That whitespace is real.

Sources: [YC W26 breakdown — Extruct](https://www.extruct.ai/research/ycw26/), [YC W26 — Sameer Nanda](https://sameernanda.com/yc-w26-batch-analysis/), [TechCrunch — YC AI codebases](https://techcrunch.com/2025/03/06/a-quarter-of-startups-in-ycs-current-cohort-have-codebases-that-are-almost-entirely-ai-generated/), [Inception Mercury 2](https://www.inceptionlabs.ai/), [Vocode YC profile](https://www.ycombinator.com/companies/vocode).

---

## 2. Defensibility vs Cursor, Lovable, v0, Bolt, Replit, Cognition

**The honest framing: eri is not "Cursor but voice." eri is a new interaction model for code, on top of a latency primitive nobody else has wired up end-to-end.**

What's defensible:

- **The full loop is sub-2s, and that's not a feature — it's a different product.** Cursor uses Sonnet/Haiku autoregressive models; even with prediction it can't hit the *speech-pace* loop because the underlying token rate is wrong. Mercury 2 generates in parallel (1000+ tok/s, 5–10× faster than Haiku at comparable quality). eri's predictive-fire gate (500ms stability, 1.2s min-gap, 14-char floor — see `eri_ui.rs:130–147`) speculatively fires before the user even finishes the sentence. That is the wedge. A competitor copying "add voice to Cursor" without rebuilding around a diffusion backbone gets a 6–10s loop, which feels broken.
- **Voice + gaze together solve disambiguation, which is the actual hard problem with voice coding.** "Make this bigger" is useless unless eri knows what *this* is. Gaze gives a deictic anchor for free, no UI to learn. This is hard to copy because it requires a native app with camera permissions, a calibrated sidecar, and gaze→DOM/editor mapping (which eri already has via `GazeTarget::{Preview,Editor,Panel}`).
- **Hard fork of Zed.** GPUI gives 120fps native rendering on macOS; Electron-based competitors (Cursor, Windsurf) can't match the input latency floor. This compounds with voice — users feel the responsiveness.
- **Two-tier inference: cheap fast brain + heavyweight ship-it.** Mercury does the iteration loop; Claude Code CLI does the autonomous polish + deploy at the end. The brain (Llama-3.2-1B on-device) gives spoken acks so the user never feels lost during the 1.5s edit. Three models, each doing what it's best at. Cursor uses one model class for everything.

Where eri loses, honestly:

- **Cursor wins on keyboard power-users and enterprise distribution.** 4M+ users, $2B ARR. eri is not going to beat Cursor at "I want to alt-tab and type fast in TypeScript."
- **Lovable/v0 win on zero-install browser onboarding.** A non-engineer can paste a prompt at lovable.dev in 10 seconds. eri requires a download.
- **Devin/Cognition wins on long-horizon autonomous work.** A 4-hour PR is not eri's product.
- **Bolt/Replit own "build a full-stack app from scratch in the browser."** eri ships fast iterations on an HTML/JS sandbox today, not Postgres + auth + deploy.

**eri's defensible niche: the fastest possible voice→working-preview loop for prototype-grade UI work, with one keystroke to escalate to Claude for production hardening.** That's the wedge. Everything else expands from there.

Sources: [Mercury 2 speed/pricing](https://openrouter.ai/inception/mercury-2), [Lovable + Cursor + Replit ARR](https://medium.com/@aftab001x/the-2026-ai-coding-platform-wars-replit-vs-windsurf-vs-bolt-new-f908b9f76325).

---

## 3. The 90-Second YC Demo Script

**Setup (already on screen at t=0):** eri is open, iterator panel docked right, blank preview pane on left, mic icon green, gaze dot visible.

| t | Founder says | eri does / screen |
|---|---|---|
| 0:00 | "This is eri. I'm going to build a working app with my voice in under 30 seconds." | Mic pulse |
| 0:05 | "Build me a Pomodoro timer with a big circular dial, dark mode, start and reset buttons." | Brain says "got it, building it" at ~0:06. Mercury fires at 0:07 on stable partial. |
| 0:09 | *(silent)* | Preview pane renders Pomodoro timer at 0:08–0:09. Iteration #1 logged. |
| 0:10 | "Make the dial purple." *(looks at the dial — gaze dot lands on preview)* | Gaze→Preview target locked. Mercury fires at 0:11. Preview updates 0:12. Iteration #2. |
| 0:14 | "Add a 5-minute break mode toggle below the buttons." | Edit lands 0:16. Iteration #3. |
| 0:20 | "Scrub back two." *(iteration scrubber rewinds to #1)* | Preview flips back to plain timer. "See — every state is replayable." |
| 0:28 | "Forward to latest. Now ship it." | Status flips to "Claude Code engaged." Terminal panel scrolls — Claude is hardening, adding tests, deploying to Vercel. |
| 0:35 | "While Claude finishes, here's what just happened: voice-to-pixels in 1.5 seconds, three iterations in 20 seconds, and now an autonomous polish pass with tests and a live URL." | Architecture diagram overlays: Whisper → Llama brain → Mercury (1000 tok/s diffusion) → preview. Side: Claude Code CLI → Vercel. |
| 0:55 | *(Claude finishes)* "There's the URL. Production build, deployed, tested. From my voice to a shippable app in 55 seconds." | Vercel URL appears. Click → real deployed app in a browser tab. |
| 1:10 | "Cursor takes 6 seconds per edit. Lovable takes 30. We take 1.5, because we're built on a diffusion model and a Zed fork. Voice is the interface non-engineers always wanted; gaze is what makes it work." | Single-slide closer: logo, "voice-pace code", three numbers (1.5s edit, $0.75/M output tokens, 0 install steps for the demo viewer at eri.dev). |
| 1:30 | END. | — |

The two moments to nail: **0:08 (first preview lands while founder is still mid-sentence)** and **0:35 (autonomous ship-it kicks in on a single voice command).** Practice the first 15s to muscle memory.

---

## 4. Pricing + Distribution

**Pricing.** Two tiers.

- **Free / BYOK.** Download, plug in your own Inception Labs key + ElevenLabs key + Anthropic key. All sidecars local. Zero recurring cost to us. This is the open-source-shaped acquisition surface; even if 90% never pay, they post demos on Twitter.
- **eri Cloud — $30/mo.** Hosted Mercury proxy with our enterprise rate limit, hosted ElevenLabs voice, telemetry-backed cost dashboard, project sync across devices, one-click Vercel/Netlify deploy. Pricing anchored below Cursor Pro ($20) is wrong — we're a premium creative tool, not a code completer. $30 signals "this is for makers who ship."
- **Teams — $60/seat/mo** later, when collab lands.

Margins: Mercury at $0.25/$0.75 per M, typical 800-token edit ≈ $0.0006. At $30/mo we tolerate ~40,000 edits/user/mo before margin compresses. Comfortable.

**Distribution — pick exactly three channels:**

1. **Twitter/X video demos.** The 90s demo above is the artifact. One per week, each showing a different build (Pomodoro, landing page, Tetris, dashboard). Founders read like Pieter Levels did for Photo AI.
2. **Hacker News launch + Show HN cadence.** Initial Show HN tied to "voice + diffusion = sub-2s code." Follow with a Show HN every 6 weeks tied to a new capability (gaze, ship-it, eri.dev browser).
3. **YC partner-network warm intros + a single recruiter post on the YC alumni Bookface.** This is how you get the W26/S26 batch using eri before public launch, which becomes social proof.

What *not* to do: paid ads, dev influencer sponsorships, conference booths. Wrong audience.

---

## 5. Next 3 Things to Build (After Error Recovery + Cost Telemetry + Onboarding)

1. **eri.dev — browser preview of the desktop experience.** A WASM-cut-down version that runs a single voice→Mercury→preview loop in the browser, no install. Lovable wins on zero-install; we need a zero-install front door that funnels to the desktop app for serious work. Even a 30-second hosted playground at eri.dev/try doubles conversion. Cost: 2–3 weeks; lift the existing `eri_preview` crate's HTML target into a Cloudflare Worker + Mercury proxy.
2. **Inline Mercury rewrites in the editor (not just the preview).** Today eri excels at the preview/build path. The Cursor-killer move is: cursor sits in a `.tsx` file, user says "extract this into a hook", and a 600ms diffusion rewrite lands in-place with a diff gutter. Same Mercury backend, new surface. This is the move that takes eri from "prototype tool" to "I use it for real work."
3. **Liveblocks-style multiplayer + shareable iteration timelines.** Each project's iteration scrubber becomes a public URL: `eri.dev/p/abc123` shows the full voice-tagged iteration tree, anyone can fork. This is the viral loop. It also doubles as the team-collab story for the $60/seat tier.

Deliberately *not* on this list: a marketplace, a mobile app, a Windows port, an LSP for eri-flavored anything. Stay narrow.

---

## 6. Honest Weaknesses (Pre-Answered)

- **"You're a wrapper around Mercury, ElevenLabs, Whisper, and Claude."** True. So is Cursor a wrapper around Sonnet. The wrapper *is* the product when the orchestration (predictive fire, gaze disambiguation, sub-2s loop, brain-acks, iteration scrubber, ship-it handoff) is the differentiator and the latency primitive is uncopyable without a from-scratch rebuild.
- **"What if Inception Labs gets acquired / shuts off the API / 10×s pricing?"** Mercury is one of several diffusion LLMs in flight (DiffuLLaMA, Gemini Diffusion). We abstract behind `InferenceBackend` (already done — see `eri_inference`). Worst case, we self-host an open diffusion model on H100s; cost goes up, product survives.
- **"Voice is a niche."** Voice + gaze + sub-2s is *not* a niche, it's an unexplored UX. The mistake everyone made with voice coding (Talon, Serenade) was forcing dictation of syntax. We're not dictating syntax — we're dictating *intent* to a diffusion model. Different product.
- **"Why won't Cursor just add voice?"** They might. They won't add diffusion (Anthropic+OpenAI relationships); they won't add gaze (Electron); they won't rebuild the loop. Adding a voice button on top of a 6s loop is worse than no voice button. We have a 12–18 month head start on the integrated bet.
- **"Hard fork of Zed is a maintenance liability."** Real risk. Mitigation: cherry-pick upstream weekly, keep eri_* crates as additive panels (already done), do not modify core editor internals where avoidable.
- **"Mac-only."** Yes, deliberate for v1. Windows/Linux gaze sidecars are doable in year 2 once we know the product is loved by 10k Mac creators.

---

## Elevator Pitch (YC application body)

eri is a voice-driven AI IDE that turns spoken intent into running code in under two seconds. We hard-forked Zed for native 120fps rendering, wired Whisper for streaming speech, gaze tracking for "make this bigger" disambiguation, and the Mercury 2 diffusion LLM — which generates tokens 5–10× faster than any autoregressive model — for the actual edit. A 1B-parameter on-device brain handles spoken acknowledgements; Claude Code CLI runs the autonomous polish-and-ship pass on demand. The result is an interaction model nobody else has: you talk, you watch the preview update mid-sentence, you say "ship it," and a tested production build deploys to Vercel. Cursor can't do this because their loop is the wrong shape; Lovable can't do this because they're a web app on autoregressive models; Devin can't do this because they optimized for hours, not seconds. We've built the only voice-pace code product, and we're going to own the makers, hobbyists, and PMs who never wanted to learn keyboard shortcuts.
