# eri local-engine tier (the small fast model)

> Status: **design / R&D.** The seams below exist in the codebase today; the
> local *chat* provider and the low-level routing are not wired yet. This doc is
> the plan, grounded in what's already there — not a claim that it ships now.

## The idea

eri's brain is **Claude** (hard reasoning) + **Mercury** (fast diffusion edits).
But a lot of what eri does every second is *low-level*: classify an intent, pick
a route, decide if a goal is in-bounds, summarize a screen, rank memories. Paying
a Claude round-trip for each of those is slow and token-expensive.

So eri grows a **third engine: a small local model (≈0.5B–3B params)** that runs
on the user's machine at high tokens/s. It handles the cheap, high-frequency,
low-stakes calls **with zero cloud tokens**, and only escalates to Claude when
the task actually needs frontier reasoning. This is the eri-credit thesis taken
to its limit: *don't spend a cloud token on something a 1B model nails locally.*

This is **Tier 1** of the token-frugal router (Tier 0 = deterministic fast-lane,
0 tokens; Tier 1 = local model, 0 cloud tokens; Tier 2 = cloud, minimized).

## What already exists (the seams)

- **`eri_tab::OllamaClient`** (`crates/eri_tab/src/ollama.rs`) — eri already talks
  to a local Ollama server for the autocomplete tab engine. The local-inference
  transport is built.
- **`eri_tab::LlamaTabEngine`** — a local Llama engine with `candle` and `ollama`
  backends behind cfg features.
- **`ModelChoice::Local(String)`** (`eri_router`) — the router's model menu
  already has a local lane.
- **`LlmProvider` trait** (`eri_inference/src/llm_provider.rs`, `fn complete`) —
  the provider seam the cloud providers (anthropic/gemini/openai) implement.
- **`eri_index` candle + ollama embedders** — local embeddings already ship.

## What's missing (the work)

1. **`OllamaProvider` (or `LocalProvider`)** implementing `LlmProvider::complete`,
   reusing the `eri_tab::OllamaClient` transport. This makes `ModelChoice::Local`
   *executable* (today `brain_iteration.rs` returns `UnsupportedModel` for it).
2. **Tier-1 routing policy** — a deterministic table of which task kinds go local
   vs cloud. Start conservative (local only where a wrong answer is cheap and
   re-checkable):
   - intent classification (`eri_inference::intent`)
   - route/complexity pre-classification for the cloud router
   - memory ranking / dedup, short summarization of a screen snapshot
   - draft fast-lane confirmations
   Anything that writes code, spends money, or actuates stays Claude/Mercury.
3. **Model selection** — ship a default small GGUF the user pulls once:
   candidates ~0.5–3B, e.g. Qwen2.5-0.5B/1.5B/3B-Instruct or Llama-3.2-1B/3B,
   chosen for tokens/s on a laptop CPU/ANE. The `ModelProfile` for Local already
   exists (32K window, Llama3 tokenizer estimate).
4. **Confidence gate** — the local model returns a confidence/should-escalate
   signal; low confidence falls through to Claude. The local model is a *filter*,
   not a final authority, on anything that matters.

## Self-improvement (the sia direction)

eri already records every step to a per-workspace **`eri_graph::Graph`** and has a
local **memory** store. The self-improving loop (hexo-ai/sia style) sits on top of
those, locally:

1. **Log** — outcomes already land in the graph (which route was taken, did the
   build pass, did the user undo it).
2. **Critique** — a periodic local-model pass over recent traces: where did eri
   escalate to Claude when the local model would have sufficed? Where did the
   local model answer wrong and cost a redo?
3. **Refine** — adjust the Tier-1 routing table + the learned-patterns memory
   (no weight training required for v1 — it's routing + retrieval that improve).
   Optional v2: LoRA/SoNA-style local adaptation of the small model on the user's
   own corrections (candle supports this; keep it on-device, never pooled).

The win compounds: the more eri runs, the better it knows *which* tasks it can do
locally for free — so cloud spend drops over time per user, on the same plan.

## Honest scope

- v1 (buildable, bounded): `OllamaProvider` + a small Tier-1 routing table +
  confidence gate. Measurable via the eval harness (`scripts/eval`): % of tasks
  served locally, and quality delta vs all-cloud.
- v2 (R&D): on-device adaptation / a custom small model + the full critique→refine
  loop. This needs data + iteration; it is *not* a quick build, and we won't
  pretend otherwise.

Everything here is **eri** — the local engine, the router, the memory, the
self-improvement — are eri's own; Claude and the local model are interchangeable
engines behind eri's seams, never surfaces the user sees or can name.
