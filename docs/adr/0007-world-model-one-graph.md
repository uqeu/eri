# ADR-0007: the world model is one graph — unify memory into eri_graph; build it Claude-reasoned, two-pass, self-improving

- Status: Accepted (amends ADR-0001 §1)
- Date: 2026-06-19
- Context: The "digital human" direction ([[project_eri_digital_human]], docs/plans/eri-digital-human.md). Resolved in a grill-with-docs session.

## Context

eri is becoming a **world model** of one person and their world (people, projects, apps, relationships, habits, life events, current state) — the top-level concept the capabilities feed into; **Memory is one component of it, not the whole** (see CONTEXT.md). ADR-0001 kept memory as flat observations in a JSON store behind `eri_inference::memory`, with `eri_graph` as a *separate* session/prompt/error graph. A world model needs first-class **entities and relations**, which the flat store can't express, while `eri_graph` is already a generic property graph (Node/Edge + string kinds + JSON body + tags, SQLite-backed). We have **zero users**, so a one-time memory reset is acceptable.

## Decision

1. **One graph is the brain.** `eri_graph` becomes the **canonical world-model store**. Episodic observations become nodes (carrying their bi-temporal `valid_from`/`valid_to` + `Visibility` lifecycle + importance/recall fields), entities become nodes (`person`/`project`/`app`/`topic`/`place`/`life_event`), relations become edges (`works_with`/`owns`/`uses`/`part_of`/`collaborates_on`), with **provenance edges** (`evidences`/`mentions`) linking observations to the entities they support, plus `superseded_by` and `rolled_into` edges. This **amends ADR-0001 §1**: the JSON observation store is retired (one-time wipe, pre-users). The good *cognition* of `eri_inference::memory` — hybrid recall ranking, Ebbinghaus decay, MMR, consolidation, contradiction/supersession, Tier-A projection, Tier-B E2E sync — is preserved as **operations over the graph**, not a second store. `eri_inference::memory` remains the *API seam*; `eri_graph` is the substrate beneath it. (ADR-0001 §2 two-tier sync and the `K_user`/Tier-A model stand; the blob is now a graph export.)

2. **World model v1 = model-of-you the base engine reasons over** (not a learned latent). Claude is the base engine; eri supplies the structured graph it reasons/plans over. A learned per-user latent ("own-model era", JEPA/Dreamer-inspired) is the **horizon (P5)**, not v1.

3. **Two-pass, token-frugal population.** Ingest (hot path, 0 cloud tokens): write the raw observation node + run the deterministic analyzers (event-time, register, surprise-gate dedup) + cheap local entity tagging. **Reflection pass** (cold path, batched at thresholds, base engine or local tier): extract/upsert entities + relations + semantic rollups with provenance, handle supersession. Extends `consolidation.rs`; the base engine never sits on the write hot path.

4. **One predict→gate→act→observe→learn cycle.** The control loop (`control_turn`/`control_agent`) is wrapped so each turn **predicts** (plan + outcome forecast + confidence + reversibility/risk class, base engine over the graph) → **gates** via the ADR-0006 confirmation envelope → **acts** → **observes** (writes back to the graph) → feeds the self-improve loop. The *same* cycle serves commanded turns and proactive (unprompted) turns.

5. **Self-improvement (sia) = refine data + policy, no weight-training in v1.** Signals: action outcomes, user corrections (undo, edit-reject), escalations, envelope confirm/reject. Updates: the world model (facts/patterns/multi-step chains), the confirmation envelope (learned cautions + standing grants, extending `control_safety`), the routing policy (extending `ControlTurnLog`), and preferences. No fine-tuning in v1; per-user LoRA is the P5 own-model era.

## Consequences

- One store to reason over, query (entities/relations), and sync — closer to how a brain holds it. `eri_inference::memory` cognition is ported to graph-backed ops; callers keep one memory API.
- A one-time memory reset on cutover (acceptable: zero users). The ADR-0001 "silent wipe via K_user tombstones" risk is moot pre-GA; revisit memory export/backup before Tier-B GA.
- `eri_graph` gains entity/relation kinds + bi-temporal/visibility fields on nodes; recall ranking + Tier-A distill move to graph queries.
- First vertical slice (TDD): unified brain-graph + entity kinds + reflection-pass extraction + entity-aware recall & Tier-A profile. Proof: eri answers "who do I work with on X?" from the graph and the profile shows real people/projects. (Full plan + phases: docs/plans/eri-digital-human.md.)

### Accepted risks

- **Porting regressions.** Moving recall/consolidation/sync onto the graph can regress hard-won behavior (decay, MMR, supersession). Mitigation: port behind the existing `eri_inference::memory` API with the current tests kept green as a contract; add graph-level tests per ported op.
