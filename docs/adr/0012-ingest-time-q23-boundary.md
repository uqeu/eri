# ADR-0012: the ingest-time Q23 boundary — auto-indexed data is privacy-screened BEFORE it is stored, not just before it is projected

- Status: Accepted
- Date: 2026-06-29
- Context: [[project_eri_digital_human]], [[project_eri_cloud_pivot]]. Builds on ADR-0001 (Tier-A/Tier-B memory), ADR-0007 (one world graph), ADR-0008 (confidential cloud-resident world model), ADR-0010 (recall seam + the egress Q23 gate). Introduced by Phase 2 #5, the auto-index "dreaming" loop ("connect → auto-index your life").

## Context

Until now the Q23 privacy screen (`profile::looks_sensitive` — the credential / financial / health / intimate zones) gated only the **egress**: the recall projection that leaves the confidential brain for the server-readable Tier-A store (ADR-0010 §5). Everything the user explicitly `remember`ed could enter the world model; the gate stopped the sensitive parts from being *projected*.

The dreaming loop changes the threat model. It reads the user's **real connected accounts** (Gmail / Calendar / Drive via Composio) — a whole inbox, not a handful of deliberate facts. The user does not choose each item, and an inbox is full of password resets, lab results, bank statements, and intimate messages. A loop that indexes a life is exactly where the loyalty + confidentiality spine has to hold. Storing that content confidentially and merely declining to project it is **not** good enough: stored data is data that can leak (a future bug, a future feature, a compromised host). The safe posture for auto-indexed data is **data minimization** — don't store it at all.

## Decision

1. **Promote the Q23 screen to the INGEST boundary for auto-indexed sources.** Connection-sourced observations are screened by the **one canonical** `looks_sensitive` (no copy) and **DROPPED before storage** — they never become a world-graph node, an entity, or an edge. Nothing stored, nothing to leak. (`eri_inference::memory::connections::ingest_connections_into`.)

2. **DROP, not redact.** A sensitive observation is removed in full, not partially masked — masking leaks structure and risks a missed token. Fail-closed + deliberately broad (a false positive just means eri doesn't learn one benign fact).

3. **Refusal-grade, leak-tested.** The ingest screen carries the same rigor as the refusal boundary and the recall-gate: a fixture credential / financial / health / intimate snippet must be provably absent from the graph after ingest. It is the same `looks_sensitive` the egress gate uses — a single source of truth, never a second copy.

4. **Defense in depth — the egress gate stays.** ADR-0010's projection gate is unchanged: even if something slipped ingest, it still cannot reach the server-readable store. Two independent screens, one canonical implementation.

5. **Scope: auto-indexed data only.** This pre-filter applies to connection ingest (data the user did not hand-pick). **Explicit `eri remember` is NOT pre-filtered** — the user deliberately chose to tell eri, a different trust act; the egress gate still protects whatever ends up in the model. (If a future setting wants to pre-filter explicit memories too, that is an additive opt-in, not this ADR.)

## Consequences

- **Stronger privacy, by minimization.** The most sensitive slice of a user's life never enters the brain — the strongest possible guarantee (you cannot leak what you never stored).
- **Accepted loss of completeness.** eri will not learn the sensitive facts from connected accounts (a doctor's appointment, a salary number). For the four Q23 zones, confidentiality outranks completeness. The user can still teach eri such a fact explicitly if they choose (scope #5).
- **Single-principal + idempotent are inherited**, not re-implemented: connection ingest opens the `user_id`-scoped graph (AAD-isolated) and rides `ingest_all`'s `source_id` idempotency, so a backfill is resumable and never cross-principal.
- **One screen to evolve.** Tightening a Q23 zone (or adding the Claude precision pass above the keyword floor) improves ingest and egress at once.
