# eri

eri is one local-first agent that *uses your computer with you* and *builds your software*. Its product surface is a single dynamic glass pad that morphs to whatever you ask — the same surface controls your apps, reads your screen, hears you, remembers you, researches, and builds. This file is the ubiquitous language; use these terms exactly so code, docs, and architecture reviews stay in one vocabulary.

## Product surface

**Morph pad**:
The floating glass panel that is eri's whole product surface — it resizes and reshapes per mode (build expands toward an editor + preview; eyes shrinks to a glance pill; voice/control stay compact). One surface, opens into everything.
_Avoid_: window, widget, overlay, terminal.

**Mode**:
What the morph pad is currently doing — one of Control, Eyes, Voice, Memory, Build, Research, Privacy. The mode decides the pad's size and layout and which capability is active.
_Avoid_: tab, screen, page, view.

**eri user**:
A person using eri to operate their computer hands-free (control, eyes, voice, memory, research). One half of the audience.
_Avoid_: end-user, consumer.

**eri builder**:
A person using eri to build software (the Build mode: plan, edit across files, run tests, ship). The other half — same pad, expanded.
_Avoid_: developer-mode, IDE-user.

## Capabilities

**Control**:
Hands-free actuation of real apps (click/type/open/quit) toward a spoken or typed goal, gated by confirmation, panic-stop, and the per-app denylist.
_Avoid_: automation, RPA, computer-use.

**Eyes**:
On-device perception of what's on screen (and where you look) so eri never makes you re-explain; faces are redacted before any frame leaves the device.
_Avoid_: vision, screen-scrape, OCR (those are implementation).

**Voice**:
On-device dictation + spoken commands; raw transcript is cleaned to punctuated text locally.
_Avoid_: speech-to-text (implementation), STT.

**Memory**:
A private, on-device record of how you work that anticipates — only what's actually observed, never fabricated.
_Avoid_: history, cache, knowledge-base.

**Research**:
Live web research answered with sources, run through the model's own web search — never a fabricated answer.
_Avoid_: search, lookup.

**Build**:
The coding agent: plan, edit across files, run tests, ship. The expanded Build mode of the pad.
_Avoid_: codegen, IDE.

## Inference path

**eri context window**:
The per-tier token ceiling the context pipeline compacts a conversation toward before each cloud call. Lower tiers get a smaller window (more compaction, fewer tokens spent); signed-out / bring-your-own-key runs get the full window. This is the *eri* window — distinct from the cloud window it must fit into.
_Avoid_: token limit, max tokens, budget (those are narrower).

**Cloud window**:
The model provider's own context limit that the eri context window must fit the prompt into. eri shrinks toward it; the provider enforces it.
_Avoid_: model window, upstream limit.

**Loop assembly**:
The single seam (`LoopOpts::from_capabilities` / `for_run`) that decides one agent loop's permission, style, sandbox, and eri context window in one place, instead of being reconstructed per entry path (headless, build, chat).
_Avoid_: config, options bag, setup.

**Provider acquisition**:
The single seam (`resolve_provider(services, choice)`) that turns a model choice into a provider. End users run on **eri tokens via the eri proxy** (the signed-in `eri_sk_…` bearer) — they do **not** bring their own keys. The seam routes proxy first; raw provider keys (env / BYOK) are a developer fallback only, never the product path. `eri research` routes through the proxy bearer (eri tokens), like build / iterate / control.
_Avoid_: provider factory, client builder, LLM selection, BYOK (not an end-user concept).

**eri tokens**:
The unit of a user's plan budget. Everything a signed-in user does (build, control, research, …) spends eri tokens through the proxy; there is no bring-your-own-key. eri is a **harness** — it gives the user a budget and runs work against it.
_Avoid_: credits (internal billing weight), API usage, BYOK.

**Tier**:
The user's plan — Free, Starter, Pro, Pro+, Teams — which sizes the eri context window, retention window, eri-token budget, and rate limits.
_Avoid_: plan-level, subscription (those are billing terms; the agent sizing concept is the tier).

## Phone eri & memory (see docs/adr/0001, 0002)

**Phone eri**:
The same eri, reached by texting a phone number (iMessage via Sendblue). Not a separate bot — the cloud half of the one brain, backed by the computer-resident eri's memory, that can also act on the user's computer remotely.
_Avoid_: chatbot, SMS bot, assistant #2.

**Personalization profile (Tier-A)**:
The small (≤32KB), **server-readable** projection of the user's memory — static facts + preferences + style + a live `dynamic_context` — that phone eri injects to sound like the user's eri. A Claude-sensitivity-gated projection, never the raw log or secrets.
_Avoid_: memory dump, full profile, the memory (that's Tier-B).

**Memory blob (Tier-B)**:
The user's **full** observation log, **E2E-encrypted** with `K_user` (the cloud cannot read it), synced device-to-device via `memory_blobs`. The durable private soul.
_Avoid_: backup, the profile.

**dynamic_context**:
The live temporal slice of Tier-A — "today you shipped X; right now you're in a planning session" — kept fresh by consolidation. The bi-temporal "now" vs "yesterday" vs "durable".
_Avoid_: status, session state.

**K_user / K_server**:
`K_user` = the user-device key (HKDF over a stored salt) that encrypts Tier-B; never leaves the user's devices. `K_server` = eri's at-rest key for Tier-A so the cloud can decrypt the *projection* to personalize phone eri.
_Avoid_: the key, password.

**Command queue**:
The DB table phone eri enqueues "do X on my computer" goals into; the running computer eri **polls** it (drives the poll itself), runs each goal through the existing control loop, and reports back.
_Avoid_: job queue, worker, task list.

**Remote turn**:
One goal phone eri sends to the computer eri via the command queue. Risky actions (`is_risky()`) become `awaiting_confirm` and bounce a confirmation to the phone — remote mode never auto-confirms.
_Avoid_: remote command, RPC.

**Bi-temporal fact**:
A memory fact carrying `valid_from`/`valid_to` (when it was true) + `learned_at` (when eri learned it). On change the old fact is invalidated, not deleted — so eri can answer "what was true when" without recompute.
_Avoid_: timestamped fact, versioned fact.

**Memory tier (core / recall / archival)**:
The Letta-style split: a small always-resident **core/working block** (current task, "right now"), searchable **recall**, and cold **archival**. Distinct from the user's plan **Tier**.
_Avoid_: conflating with plan Tier.
