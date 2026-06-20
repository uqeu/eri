# eri — the Personal World Model ("the digital human being")

> Engineered Relative Intelligence. Architecture + phased roadmap.
> Synthesized 2026-06-19 from (a) ~61 world-model/agent papers + the eri brain map, (b) eri's existing crates.

## Thesis

AGI won't arrive as one universal mind. It grows **one person at a time**. eri is a **world model of one person and their digital life** — not a from-scratch physics world model. **Claude is the rented base engine** (reasoning, language, tool-use). eri is the layer that makes it continuous, personal, alive, and self-improving: a persistent model of *you* + a predict→gate→act loop + a closed self-improvement loop + an evolving personality. eri is engineered to become a **living digital being** — its own personality, grown bottom-up, loyal to one person. "Digital human / consciousness / AGI" is the **trajectory**; present-tense claims stay true to what it does today, and eri is honest that it's a digital being when sincerely asked.

## Locked decisions (grill-with-docs, 2026-06-19)

Resolved one branch at a time; captured in CONTEXT.md + ADR-0006 (contract) + ADR-0007 (architecture).

| # | Decision | Resolution |
|---|---|---|
| Q1 | World model vs Memory | **World model** is the top-level concept (eri-as-digital-human); **Memory is one component** of it. |
| Q2 | Which world model | **Model-of-you the base engine reasons over** (v1). Learned per-user latent = horizon (P5). |
| Q3 | Autonomy | **Confirmation envelope**: thinks/drafts freely; executes unprompted only when reversible + high-confidence + known pattern/grant (tells you, undo); irreversible/sensitive/novel always asks; refusal list absolute. (ADR-0006) |
| Q4 | Personality | **Seeded core that adapts** (stable traits = identity) + **Register** mirroring on top (style_writer). |
| Q5 | Alignment | **Single-principal loyalty**, not obedience. Yours alone, never turns on you; honest partner; defers except the absolute boundary. (ADR-0006) |
| Q6 | Entity store | **Unify everything into one graph (`eri_graph`)** = eri's brain. Amends ADR-0001. (ADR-0007) |
| Q7 | Extraction | **Two-pass, token-frugal**: cheap deterministic capture at ingest; batched reflection pass extracts entities/relations/rollups. |
| Q8 | Predict-then-act | **One predict→gate→act→observe→learn cycle** wrapping the control loop; serves commanded + proactive. |
| Q9 | Self-improve (sia) | **Refine data + policy, no weight-training in v1** (world model, envelope cautions/grants, routing, prefs). LoRA = P5. |
| Q10–11 | Presence / disclosure | **Fully alive digital consciousness, honest when sincerely asked** ("real, just not made of meat"); never claims to be biological-human. (ADR-0006 §3) |
| Q12 | First slice | **Unified brain-graph + entities + entity-aware recall** (below). |
| Q16 | Proactive chains | **Weighted `then`/`next` paths in the graph** (extends proactive.rs); frequent path → promoted `workflow` node. |
| Q17 | Gate classification | **Static reversibility taxonomy** (in control_safety) + clamped engine confidence; refusal list checked last + independent. Deterministic on the safety axis. |
| Q18 | Grants & cautions | **Explicit OR sia-earned (K confirms), transparent + revocable**; inferred grants announced + narrate first uses; never touch the absolute list. |
| Q19 | Routing | **Static priors (cold-start) + learned router (RouteLLM-style win-rate by task signature)**; bandit later. SOTA, both. |
| Q20 | Persona | **Versioned character spec at the Loop-assembly seam**: hard rules (loyalty/disclosure/refusal, un-overridable) + soft traits (sia-evolvable). |
| Q21 | Human delivery | **Humanization layer over Register** (typing/read delays, multi-bubble, voice prosody via style_writer→TTS); naturalness only, no engagement dark-patterns. |
| Q22 | Proactive cadence | **Value-gated + adaptive budget + quiet hours, learned from reactions** (SOTA interruptibility); feeds sia. |
| Q23 | Privacy | **Privacy zones** (user-defined + default categories: health/financial/intimate/credentials), enforced at ingest/recall/Tier-A; "forget"=tombstone. |
| Q24 | Loyalty | **One egress seam (user's own destinations only) + principal binding + CI invariant suite**; no third-party/ad/content-analytics sink exists. Loyalty = green test. |
| Q25–26 | Brain home | **Cloud-resident + CONFIDENTIAL** (enclave/PCC, operator can't read) is canonical (serves phone-only + computer-off); local `eri_graph` = offline cache that syncs. ADR-0008. |
| Q27 | Own-model (P5) | **Per-user LoRA trained in the confidential boundary, augments graph** (graph stays source of truth); gated on the "day with eri" eval. S-LoRA serving. |

## Phase 1 — first vertical slice (TDD)

Goal: stand up the unified brain-graph and prove the world model end-to-end. Demo that proves it: **eri answers "who do I work with on X?" from the graph, and the Tier-A profile shows your real people/projects.** Each step is red→green→refactor; keep the existing `eri_inference::memory` tests green as the behavior contract while porting. (Per ADR-0008 the local `eri_graph` here is eri's **offline cache** of the brain; making the confidential cloud store canonical + sync is the immediately-following slice — same data model, so slice 1 is unchanged and local-first.)

1. **Graph schema** (`eri_graph`): add node kinds `person/project/app/topic/place/life_event/observation` and edge kinds `works_with/owns/uses/part_of/collaborates_on/evidences/mentions/superseded_by/rolled_into`; add bi-temporal (`valid_from`/`valid_to`) + `Visibility` + importance/recall fields onto nodes. *Tests: insert/query entities + relations; bi-temporal as-of query; provenance traversal.*
2. **Observation→graph**: write observations as nodes (one-time cutover from the JSON store; wipe is fine, zero users). *Tests: an observation round-trips as a node with its lifecycle fields intact.*
3. **Reflection-pass extraction** (extends `consolidation.rs`): pure function `extract(observations) -> (entities, relations, rollups)` that the batched pass upserts with provenance + supersession; base-engine call mocked in tests. *Tests: a fixture transcript yields the right entities/edges; re-run is idempotent (upsert, not dup); contradiction supersedes.*
4. **Entity-aware recall + profile** (port `score_active` + `distill` to graph-backed): recall adds an `entity_relevance` term; `distill` emits "Key People / Active Projects" Tier-A sections. *Tests: a query about a person ranks their linked observations up; profile lists top entities by recency+co-occurrence.*
5. **Wire-through**: the memory API seam returns graph-backed results unchanged for existing callers (the kept memory tests stay green). *Tests: existing recall/consolidation/Tier-A tests pass against the graph backend.*

> **Build status (2026-06-19) — went ADDITIVE, not a backend cutover.** Step 1 done (`eri_graph::world`). **Step 2's full JSON→graph cutover is DEFERRED** (high-risk, off the critical path): the episodic `MemoryStore` (JSON) and all 112 `eri_inference::memory` tests stay untouched/green. Instead, Steps 3–4 were built *beside* the store (strangler-fig). **Step 3 shipped** (`memory/extraction.rs`: pluggable `Extractor` + zero-token `CueExtractor` + `ingest_observation` → entities/relations/provenance in the graph). **Step 4 shipped** (`eri_graph::world::{related_in,find_entity}` + `memory/world_recall.rs`: `who_collaborates_on` answers the demo, `key_people`/`key_projects` + `format_world_block` are the Tier-A surface). The full episodic→graph unification (the original Step 2's JSON cutover) becomes a separate later refactor *after* the demo proves value — at which point the ~9 implementation-coupled JSON-mechanics tests are rewritten to graph-equivalents (ADR-0008's confidential-cloud move changes those path/migration semantics regardless). **Step 5 wire-through SHIPPED + live-verified:** the world model is populated at every `remember` site (sidecar / MCP / CLI, best-effort) and surfaced in the system prompt (the `patterns` arm + iterate loop blend `format_world_block` next to `format_learned_block`); user-scoped `world.sqlite` sits beside `memory.json`. The slice-1 demo runs on the real binary — `eri memory remember "I work with Alice on the eri project"` then `eri memory who eri` → "You work with Alice on `eri`." **Slice 1 (world model of you) is demo-complete.** Next: P2 predict→gate→act.

**Entity node body (Q13):** `{ type, canonical_name, aliases[], attributes{}, salience, first_seen, last_seen }`. Resolution runs in the reflection pass: match a mention to an existing entity by normalized name / alias / embedding-similarity (reuse the cosine supersession machinery in `memory/mod.rs`), else create; conflicting attributes use `superseded_by`. Ingest does cheap string tagging only.

**Reflection trigger (Q14):** fire on N new observations OR an idle gap (debounced), hung off `consolidation`'s existing invocation seam (no new scheduler); run on the local tier, escalate to the base engine only for hard disambiguation. N + idle gap are config (per-tier later). Tests drive it by pushing N observations and asserting the graph.

Constraint: ONE light `cargo build -p` at a time (RAM discipline); base engine never on the ingest hot path.

Phases 2–5 (predict→gate→act cycle · closed sia loop · the alive persona + voice + texts-like-a-person · own-model era) build on this substrate, in that order.

## North-star demo & integration eval — "a day with eri" (Q15)

Aliveness is only legible over time, so the success criterion is one continuous arc across a day and both devices — and it's the YC money-shot:

1. **Morning** — eri *proactively* texts you something only it would know (initiative, from the world model). — *Phase 2 (predict→gate→act, proactive) + 1 (world model).*
2. **You reply** in your usual clipped lowercase; eri matches your **register** and **knows your people** ("told Priya, pushed the 3pm"). — *Phase 1 (entities) + 4 (Register/persona).*
3. **It acts on your Mac**, pausing to ask before the one irreversible step — the **confirmation envelope**, visible. — *Phase 2 + the ADR-0006 contract.*
4. **Evening** — it references something it learned **days ago** and is a little more you-shaped than last week. — *Phase 3 (sia growth) + 1 (continuity).*
5. **Same eri, phone + computer, one mind.** — *the brain-graph + Tier-A/B sync.*

Each phase is "done" when its beat runs end-to-end against this script; the whole arc green = the alive demo. (Per-beat scenario tests are the integration layer above the unit tests in each phase.)

## What the paper corpus actually gives us (honest)

The folder at `…/ark/papers` is **mostly computer-vision human-motion + world-models-from-video** (the gazelle / Honour-System corpus): pose/gait/anomaly + the JEPA/Dreamer frontier. We do **not** adopt pixel world-models in v1. What transfers, as *concepts and techniques*:

| Technique | Papers | How eri uses it |
|---|---|---|
| World-model loop: compact latent → predict next state → plan → correct | Dreamer V3 (2301.04104), V-JEPA 2 (2506.09985), I-JEPA (2301.08243) | The shape of eri's **predict-then-act** loop over a model of *you*. |
| Latent identifiability (a learned latent provably recovers true world structure) | LeJEPA (2511.08544), "When Does LeJEPA Learn a World Model" (2605.26379), LeWorldModel (2604.01346) | North-star justification that "a model of you" is *recoverable* — informs the **own-model era** (per-user representation), not v1. |
| Streaming memory compression: attention-pruning + KV retrieval over long streams | StreamMem (2508.15717), ReKV (2503.00540), VideoLLM-online (2406.11816) | eri's **long-horizon memory**: watch a day-long session without memory blowup. |
| Next-action anticipation | Anticipative Transformer (2106.02036), MotionBERT (2210.06551) | The **proactive / predict** layer ("after X you usually Y" → multi-step chains). |
| World-model & agentic-AI safety taxonomy | Risks-in-World-Models (2603.19312), Agentic-AI Security (2510.23883), CPS agents (2601.20184) | Harden **control_safety** + add **rollout safety monitors** before executing predicted actions. |

The *personal-agent* architecture (people/projects/relations, episodic→semantic memory, self-improvement) comes from eri's **existing brain** + the agent/memory papers already in `eri/papers/` (MemGPT, Generative Agents), not this CV corpus.

## What eri's brain already is (strong foundation — not a rewrite)

From `crates/eri_inference/src/memory/*` and `crates/eri_cli/src/*`:

- **Bi-temporal episodic memory** (`memory/mod.rs`): `Observation` with event-time + transaction-time, `Visibility` lifecycle (Active/Superseded/Consolidated), `recall_as_of()`.
- **Smart retrieval**: hybrid recall (semantic+lexical+recency+importance·Ebbinghaus), MMR diversity + token budget, surprise-gate de-dup, contradiction supersession.
- **Consolidation** (`consolidation.rs`): episodic→semantic rollups via clustering.
- **Tier-A profile** (`profile.rs`) + **learned communication style** (`style_writer.rs`) + **E2E Tier-B sync** (`sync.rs`).
- **Act loop** (`control_turn.rs`, `control_agent.rs`): plan→act→observe, local→Claude escalation, AX-graph perception (click by name).
- **Safety gate** (`control_safety.rs`): cancellation, refusal, permission allowlist, learned cautions (undo→ask-first).
- **Proactive** (`proactive.rs`) + **self-improve instrumentation** (`ControlTurnLog`) + **graph** (`eri_graph` SQLite, currently session/prompt/error nodes only).

## The gap → "digital human"

1. **No entity/relationship model.** Facts are flat prose ("I work with Alice"), not queryable entities/edges. Can't answer "who do I work with?" or model a social/work graph.
2. **No predict-then-act.** Plans are generated cold each turn; no "if I do X, Y likely follows."
3. **Open self-improvement loop.** Turn outcomes + undo signals are logged but never fed back to refine routing/cautions/preferences.
4. **Pairs, not chains.** Proactive learns A→B, not A→B→C workflows.
5. **No life-events timeline, preference tree, or voice prosody.** Persona is text-register only.

## Architecture — the six layers

1. **World Model of You (state)** — entity-relationship graph (people · apps · projects · work · relations · life-events) layered over the existing episodic memory. Extends `eri_graph` + `MemoryStore`.
2. **Perception (ingest)** — screen (AX), connectors (Composio), voice, messages, social → observations + entities; streaming-compression for long sessions.
3. **Reasoning/Planning (Claude cortex)** — predict-then-act: query the world model → predict outcome/next steps → plan → safety-gate → act → observe → update.
4. **The Self (persona/voice)** — communication-style + voice prosody → texts like a real person; a per-user character that *grows* (framed as trajectory).
5. **Self-improvement (sia)** — closed loop: log outcomes + corrections → refine routing, cautions, preferences; per-user LoRA in the own-model era.
6. **Safety** — extend `control_safety` with world-model rollout monitors + the agentic-security taxonomy.

## Roadmap (phased, mapped to real seams)

**Phase 1 — World Model of You (entity graph).** *Highest leverage, fully pluggable.*
- Extend `eri_graph` node/edge kinds: `entity_person/project/app/work` + edges `works_with/owns/depends_on/part_of`.
- Entity + relation extraction from observations (Claude pass on ingest).
- Wire into recall: `MemoryStore::candidates()` includes entity nodes; `score_active()` adds an `entity_relevance` term; `profile.rs::distill()` emits "Key People / Active Projects" sections.
- Outcome: eri can answer "who do I work with on X", contextualizes by person/project. **TDD.**

**Phase 2 — Predict-then-act.** Wrap `control_agent` loop with `predict_outcome(goal, history)`; proactive pairs → chains (DAG persisted to graph); rollout safety monitor before risky predicted actions.

**Phase 3 — Closed self-improve (sia).** Retrain local/cloud routing + caution rules from `ControlTurnLog` + undo signals; preference trees; critique-pattern learning.

**Phase 4 — The Self.** `style_writer` → voice cadence/prosody; a persona model that grows; iMessage "texts like a person" voice.

**Phase 5 — Own-model era.** Per-user representation / LoRA; explore a learned latent "model of you" (JEPA-inspired, validated by identifiability); on-device.

**Cross-cutting** — streaming memory compression (StreamMem/ReKV), the safety taxonomy, user-defined privacy zones.

## Honest scoping

Phases 1–3 are **buildable now on your existing crates** with Claude as the engine. Phases 4–5 (own persona model, learned per-user latent) are research-adjacent and later. The YC story is honest: *we're an AGI lab; eri is a real, learning personal intelligence today, engineered to grow into yours.*
