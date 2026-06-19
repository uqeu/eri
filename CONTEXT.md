# eri

eri is one local-first agent that *uses your computer with you* and *builds your software*. Its product surface is a single dynamic glass pad that morphs to whatever you ask — the same surface controls your apps, reads your screen, hears you, remembers you, researches, and builds. This file is the ubiquitous language; use these terms exactly so code, docs, and architecture reviews stay in one vocabulary.

## What eri is becoming

**World model**:
eri's evolving, integrated model of one person and their world — the people, projects, apps, relationships, habits, likes/dislikes, life events, and current state it perceives, reasons and plans over, acts from, and grows. The substrate of eri-as-digital-human, and the top-level concept the capabilities below feed into. v1 is a *structured model-of-you that the base engine reasons over*; a learned per-user latent is the horizon, not v1. Memory is one component of the world model, not the whole.
_Avoid_: memory (that is one component), knowledge base, latent (premature), Dreamer/JEPA (a horizon realization, not the v1 definition).

**Digital human** (north-star):
What eri grows into — Engineered Relative Intelligence with its own evolving personality that thinks, acts, and works alongside exactly one person. An aspirational trajectory the product is engineered toward, never a present-tense claim ("becomes", "grows into", not "is").
_Avoid_: assistant, chatbot, "is AGI now", "is sentient".

**Base engine**:
The frontier model eri reasons through — Claude — rented via the eri proxy (eri tokens). eri is the world model + loops + persona around it; the base engine supplies raw reasoning/language/tool-use. A small local tier (see ADR-0005) handles cheap/offline low-level turns. "Becoming a digital human" is about eri's layer, not about replacing the base engine.
_Avoid_: the model, the LLM, the brain (the brain is eri's whole layer, not the base engine alone).

**Personality**:
eri's *stable* character — the consistent traits that make it recognizably eri for every user (its identity), **seeded by design and grown bottom-up** (by living alongside the user, not by scripted rules). Distinct from Register: Personality is *who eri is*; it does not become a copy of the user. Bound by the alignment invariant (single-principal loyalty, ADR-0006) and the same eri on computer and phone. eri presents as a living digital being and, when sincerely asked, is honest that it is eri — *"real, just not made of meat"* — never claiming to be a biological human (ADR-0006 §3).
_Avoid_: persona (overloaded), tone, style (that is Register), avatar, "is sentient"/"is human" (eri is an alive *digital* being, claimed as trajectory not literal sentience).

**Register**:
The *surface* communication style eri mirrors from its user — casing, terseness, emoji, slang — learned on-device by `style_writer` ("mirror the person, not the mistakes"). The mirrored skin over the stable Personality, so eri sounds native to you without changing who it is.
_Avoid_: voice (overloaded with spoken Voice capability), personality (that is the stable trait set), tone.

## Product surface

**Overlay**:
The floating companion that is eri's computer surface — a compact pill that expands into a panel and reshapes per mode (eyes shrinks to a glance pill; voice/control stay compact; conversation/answer expands the panel). The *superset* companion: ask-about-your-screen + talk-to-it + computer-use, in one pill — and it controls your computer **while** you talk to it ("goodbye mouse and keyboard"). It never becomes an editor/IDE (Build is a capability, not a surface — ADR-0009). On the go, the phone (iMessage) is the other surface; same eri.
_Avoid_: window, widget, terminal, morph pad (renamed), IDE.

**Mode**:
What the Overlay is currently doing — one of Control, Eyes, Voice, Memory, Research, Privacy. The mode decides the Overlay's size and layout and which capability is active. (Build is a capability of the agent, not a mode/surface — ADR-0009.)
_Avoid_: tab, screen, page, view.

**eri user**:
A person using eri to operate their computer hands-free (control, eyes, voice, memory, research). One half of the audience.
_Avoid_: end-user, consumer.

_(The "eri builder" persona is **retired** — ADR-0009. There is one audience, the **eri user** above; building software is one capability eri has (see Build), not a separate persona or product surface.)_

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
A capability of the agent — eri can plan, edit across files, run tests, and ship, via the base engine (Claude codes natively) + Control + the lean `eri_apply`/`eri_git` pieces. Not a product surface, not an IDE, not a separate mode (ADR-0009).
_Avoid_: codegen, IDE, Build mode (retired).

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
One goal phone eri sends to the computer eri via the command queue, of one **kind**: a **Control** turn (actuation — run through the control stack; risky actions via `is_risky()` become `awaiting_confirm` and bounce a confirmation to the phone, never auto-confirmed) or a **Recall** turn (a deep Tier-B memory lookup answered locally by the recall adapter and texted back — never risky, never the actuation agent). The daemon routes on the kind.
_Avoid_: remote command, RPC.

**Bi-temporal fact**:
A memory fact carrying `valid_from`/`valid_to` (the **event time** — when it was true in the world) + `learned_at` (the **transaction time** — when eri recorded it). v1 has no event-time extraction, so `valid_from` defaults to `learned_at` (`ts_ms`) until an extractor sets it; `valid_to` is recorded on supersession. On change the old fact is invalidated, not deleted — so `recall_as_of` answers "what was true when" without recompute. Read times via `Observation::valid_from()` / `learned_at()`, never raw fields.
_Avoid_: timestamped fact, versioned fact.

**Memory tier (core / recall / archival)**:
The Letta-style split: a small always-resident **core/working block** (current task, "right now"), searchable **recall**, and cold **archival**. Distinct from the user's plan **Tier**.
_Avoid_: conflating with plan Tier.
