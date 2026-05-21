# eri roadmap

Living backlog of "make the diffusion IDE number one" ideas, ordered by
expected leverage. `script/eri_strategy_check` reads the top of this file to
recommend the next move.

Format: `- [x]` = shipped, `- [~]` = in flight this session, `- [ ]` = backlog.
Add a one-line "why" so future-Claude doesn't have to re-derive intent.

---

## Pitch-critical (ship before YC interview)

- [x] **Inline Mercury rewrites in the editor** — Cursor-killer. Turns eri from prototype into "I use this for real code."
- [x] **Project templates / starters** — instant high-quality seed so Mercury isn't starting from blank HTML.
- [x] **Demo recording mode** — built-in screen+audio capture for the pitch video. No external tools.
- [x] **eri.dev landing + waitlist** — capture emails, prove demand to YC.
- [x] **One-click Vercel deploy** — "ship it" returns a live URL in 30s.
- [x] **Project persistence** — `~/.eri/projects/<slug>/` for resume + version history.
- [x] **Iteration scrubber / undo** — voice "undo", clickable history strip.
- [x] **Error recovery + retry** — 12s/45s timeouts, sidecar auto-restart, "try again" voice command.
- [x] **Cost telemetry $$** — session running total visible in panel.
- [x] **Sentry + Posthog** — see what alpha users do and what breaks.
- [x] **Onboarding flow** — 4-step first-run with key validation.
- [x] **Mercury Edit 2 apply path** — large-file iterations via `/v1/apply/completions`.
- [x] **ElevenLabs TTS** — Ava voice, fast TTFB, no robotic sound.
- [x] **Local SLM brain** — Llama-3.2-1B for "got it, building it" verbal acks.
- [x] **Auto-commit per iteration** — every Mercury turn is a real git commit, browseable in `git log`.
- [x] **Whisper speed + accuracy tuning** — turbo model, VAD, hallucination filter.
- [x] **MCP server integration** — GitHub/Linear/Filesystem tools exposed to Mercury via Anthropic's MCP standard.
- [x] **SEO + a11y auto-pass on ship-it** — Lighthouse-grade output, `{{DEPLOY_URL}}` placeholder for canonical/og:url.

## Tier 1 — viral / distribution

- [x] **Public iteration timelines / "remix"** — every project gets a shareable URL `eri.dev/p/<slug>` showing the iteration history; viewers can fork.
- [x] **One-shot CLI scenarios** — `eri run "build me X and deploy"` headless mode, for Twitter clips / CI runs.
- [x] **Discord bot** — `@eri build me a coffee shop landing page` in a channel returns the deployed URL.
- [x] **Slack bot** — same flow on Slack via Socket Mode + slash commands. 4-semaphore concurrency cap.
- [ ] **Mobile companion app** — record voice on phone, preview on phone. Voice-first means phone is a natural input.
- [ ] **eri.dev/playground** — browser-based eri with WASM Mercury client. Try without installing.
- [x] **Recording → Twitter thread generator** — "post about this" pipes recording + iterations to Claude, gets back a 6-8 tweet thread + alt-text + best-time-to-post; "copy the thread" pushes to clipboard.
- [x] **Per-user rate limits on bots** — `eri_iterator::RateLimiter` with 60s cooldown / 20 builds-per-day / $1-per-day default caps, wired into Discord + Slack.

## Tier 2 — power user features

- [ ] **Multi-file builds** — Next.js / Vite / SvelteKit scaffolds, not just single index.html.
- [x] **Component library presets (shadcn)** — shadcn-style buttons/cards/inputs/dialogs baked into the system prompt.
- [x] **Auth provider voice setup** — "add Auth0" / "add Clerk" / "add Supabase Auth" via `integrations.rs` prompt builders + `ClaudeCliBackend::run_integration`.
- [x] **Database scaffolding** — "set up postgres" defaults to Neon; "use supabase for the db" → Supabase.
- [x] **Stripe checkout one-liner** — "add stripe for $20 a month" → working checkout + webhook handler.
- [ ] **Live multiplayer collab (Liveblocks/Yjs)** — two voices in the same project, cursors visible.
- [ ] **Voice-driven Git** — "open a PR with these changes" / "review my last commit" / "merge it".

## Tier 3 — polish + quality-of-life

- [x] **Mobile/responsive preview toggle** — voice-toggle preview between Desktop (full) / Tablet (768px) / Phone (375px).
- [x] **Theme palette generator** — "use stripe colors" / "make it look like linear" → 12 curated palettes (stripe, linear, notion, coffee shop, editorial, pastel, newspaper, cyberpunk, forest, y2k, brutalist, sunset).
- [x] **Animation/motion presets** — "add motion" injects Framer-Motion-style transitions to hero/buttons/grid.
- [ ] **SEO auto-pass on ship-it** — meta tags, OG image, robots.txt, sitemap.xml generated automatically.
- [x] **Image generation hookup** — `eri_images` crate, Replicate Flux, "generate a hero image of X" / "regenerate the images", batch-of-3 regen with mechanical HTML splice.
- [x] **Voice cloning wizard** — "clone my voice" records 30s, uploads to ElevenLabs Instant Voice Clone, persists voice_id, eri speaks back in your voice.
- [ ] **A/B testing for builds** — eri generates two variants, asks "which?".
- [x] **Cost guards** — 50%/80%/100% session-limit gates, per-request gate, voice commands "pause spending" / "resume" / "raise the limit to $X" / "show cost".
- [ ] **Built-in iteration vote/comment** — share a shareable URL where friends can vote on versions.

## Tier 4 — agentic + autonomous

- [x] **Goose backend as second autonomous lane** — `AgentBackend::{Claude, Goose}` enum, `ERI_AGENT_BACKEND` env, "use goose"/"use claude" voice command.
- [ ] **Eri Agents framework** — autonomous research → code → deploy → email-me-the-link.
- [ ] **Cron scheduler** — "eri rebuild this every Monday with fresh data".
- [ ] **Time-travel debugging** — fork from any past iteration, branches as real git branches.
- [ ] **Marketplace for templates** — community can publish + sell starters; eri runs them.

## Cleanup tier — consolidate before more features

Identified by `ERI_BLOAT_AUDIT.md`. Do these BEFORE the next round of features so we don't compound debt.

- [ ] **Extract `SubprocessSidecar` abstraction** — collapse `start_camera_sidecar` / `start_tts_sidecar` / `start_brain_sidecar` / `start_voice_sidecar` (~1,000 LoC of copy-paste). Single struct with `on_line` callback. Restart-backoff bug fixes become additive instead of per-call-site.
- [ ] **Group `EriIteratorPanel` fields** — ~60 flat fields → ~15 named sub-structs (`SidecarStates`, `SessionCosts`, `PredictiveFireState`, `InlineRewriteState`, etc). File is 8,400 lines, 10× over the 800-max in CLAUDE.md.
- [ ] **Unify token estimators** — once `eri_tokens` (tiktoken) lands, delete `eri_caveman::estimate_tokens` and the `chars/4` arithmetic in `costs.rs`. One canonical entry point.
- [ ] **Fix prompt contradiction** — `SYSTEM_PROMPT` says `rounded-full`, `SHADCN_COMPONENT_HINTS` says `rounded-md`. Same prompt giving Mercury opposite design guidance. Pick one and rewrite.
- [ ] **Merge `ControlCommand` accept variants** — `Accept` + `AcceptPatch` + "yes"/"keep it"/"looks good" all overlap. Single `ControlCommand::Accept { scope: Build | InlinePatch | Bug }`.
- [ ] **Voice-command parser helper** — repeated `if prompt.contains("X") || prompt.contains("Y") ...` blocks can become a `match_phrases(&[...])` helper.
- [ ] **Clean dead code surface** — `HandoffFile` unused import, `MERCURY_WATCHDOG_TICK_MS`, `trigger_polish_pass`, `undo_last_patch_impl`, `shell_quote`, `handoff_directory` all marked dead for the entire session.

## Tier 5 — moonshots

- [ ] **VS Code lite extension** — eri-lite for users locked into VS Code.
- [ ] **Eri for non-web** — Swift/Xcode mode for iOS apps, Rust mode for systems.
- [ ] **In-browser Mercury via WebGPU** — fully client-side diffusion, zero cloud cost.
- [ ] **Eri for design** — voice-driven Figma equivalent. The next wedge after IDE.
- [ ] **Eri Pair** — two humans + eri, like real-time pair programming.

---

## North star checks (`script/eri_strategy_check` reads these as questions)

1. Can a non-technical user install eri and ship a working app in <5 minutes?
2. Does the 90-second demo work flawlessly on the first try, every try?
3. Is there a moment in the demo where the audience visibly sits up?
4. Can you name one thing eri does that Cursor literally cannot copy in a weekend?
5. If Mercury 2 disappears tomorrow, does eri still work?
6. Do you have 10 alpha users? Daily active? Paying?

A "no" to any of these is the next thing to fix.

---

## Working agreement

When dispatching parallel agents, the most common conflict is `crates/eri_ui/src/eri_ui.rs` and `crates/eri_core/src/eri_core.rs::ControlCommand`. To avoid wedging the build, dispatch at most ONE eri_ui-heavy agent at a time. Pair it with agents that work on:

- Separate crates (`eri_inference`, `eri_telemetry`, `eri_git`, `eri_mcp`, `eri_voice`, new crates)
- Separate scripts (`script/eri_*`)
- The `website/` Next.js project (totally separate)
- Pure documentation (`ERI_VISION.md`, `ERI_ROADMAP.md`, etc.)

Run `script/eri_strategy_check` after each agent batch lands.
