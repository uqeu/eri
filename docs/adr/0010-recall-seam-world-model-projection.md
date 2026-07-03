# ADR-0010: the recall seam — a server-readable world-model projection the phone reads, behind a recipient-parameterized egress gate

- Status: Accepted
- Date: 2026-06-25
- Context: [[project_phone_eri]], [[project_eri_digital_human]]. Builds on ADR-0001 (Tier-A/Tier-B memory), ADR-0002 (phone transport + command queue), ADR-0008 (confidential cloud-resident world model). The P3 sia loop and the world model (entities/relations/chains) now exist in the canonical Rust brain; the phone needs to recall from it.

## Context

The canonical brain is the Rust workspace (`eri_graph` world model + `eri_inference` memory + the sia loop) — local-first today, heading cloud-resident + confidential (ADR-0008). The phone is **serverless** (Next.js/Vercel) and cannot run or call the brain live: the brain is on the user's computer (or, end-state, inside a per-user enclave), the phone function has a few hundred ms and no worker. Yet phone eri must answer "like the user's eri" — it needs the brain's **recall**: the people/projects it knows, how they relate, what's happening right now, and what tends to follow what.

The hard problem is the residency mismatch (serverless reader vs local/confidential brain). The phone already reads a small **server-readable Tier-A projection** (ADR-0001 §2). This ADR makes recall ride that machinery rather than inventing new infra, and fixes the projection as the new confidential→server-readable trust boundary.

## Decision

1. **The recall contract.** `recall(userId)` returns a **bounded projection** of the world model:
   `{ entities: [{id, kind, name, salience}], relations: [{src, dst, kind}], recentObservations: [{text, ts, kind}], predictions: [{after, next, count}] }`, returned alongside the existing Tier-A profile (style/preferences). The four fields map 1:1 onto `eri_inference::memory::world_recall` surfaces (key people/projects → entities; relations → relations; recent observations → recentObservations; `predict_next` chains → predictions). Top-N / salience-capped, in the spirit of Tier-A's ≤32KB ceiling.

2. **A projection, not the brain.** Only this small slice is server-readable. The **full world model graph stays Tier-B** — E2E-encrypted (`K_user`) today, processed only in the per-user enclave (operator-can't-read) at the ADR-0008 end-state. The recall projection is a Tier-A-**class** artifact: `K_server`-encrypted at rest with AAD=`user_id`, a latency/UX optimization, **not** the privacy boundary on its own.

3. **The read path is a DB read, never a live brain call.** The brain **pre-computes** the projection and **pushes** it to the server-readable store (extending the existing Tier-A `Profile` + sync, ADR-0001 §2). `recall(userId)` on the phone is one bounded read of the last-pushed projection — it fits the Vercel budget (ADR-0002) and works phone-only / computer-off. Deep or live recall beyond the projection **relays to the running computer** via the command queue (ADR-0002).

4. **Cross-device is eventually-consistent — and the contract says so.** The phone answers from the **last pushed** projection (that is exactly what makes phone-only / computer-off work). Anything needing live freshness relays to the computer. The contract MUST NOT imply real-time sync.

5. **The sensitivity / privacy-zone gate IS the new boundary, with refusal-grade rigor.** Because the projection is the only world-model content that crosses confidential→server-readable, the gate that decides what enters it is a hard boundary, not a filter. It is **fail-closed**: anything health / financial / intimate / credential (the Q23 privacy zones), **or anything the gate is unsure about**, NEVER enters the projection. It reuses and hardens the existing always-on screen (`profile::looks_sensitive`) as the floor beneath the Claude sensitivity pass. A sensitive entity/observation appearing in a projection is a defect of the same severity as crossing the refusal list.

6. **Per-user isolation (single-principal).** The projection is bound to exactly one principal: keyed by `user_id`, `K_server`-AAD=`user_id`, and computed only over that user's graph. No code path lets user A's projection be read as user B (Q24 loyalty: the projection's only destination is the user's own devices).

7. **The egress gate is parameterized by RECIPIENT.** Producing the projection goes through one gate whose policy is a function of *who receives it*. Today the only `Recipient` is `OwnDevices` (self) — the projection leaves the confidential boundary only to the user's own phone. A future consented **outward** projection (the separate eri-social design: "share a slice with a specific person/eri") MUST extend *this* gate with a stricter recipient policy, not add a second egress path. (eri-social is not built here; this ADR only requires the seam be architected so it can be.)

8. **Strangler-fig convergence (no big-bang).** The phone keeps its current `learned_facts` / `personalization_profiles`. Phase A: `recall(userId)` **blends** the brain projection beside them. Phase B: as the projection proves complete, the canonical brain becomes the **source of truth** and `learned_facts` becomes a cache of it; `personalization_profiles` converge into the brain's comm-style projection. Phase C: retire the phone's standalone store once the projection fully covers it. The phone's tables become projections/caches of the one brain, never a second brain.

## Consequences

- The build splits along the §1 contract: **crates/** computes `recall_projection` + extends the Tier-A projection/sync to carry the world-model slice; **website/** (the phone window) reads the projection and blends it beside `learned_facts`. The contract is the seam.
- No new infra: the projection rides the existing `K_server` Tier-A row + sync; the phone reads the store it already reads.
- The sensitivity gate and the per-user binding become CI-tested invariants (a sensitive item never projects; a projection is never readable cross-principal), in the spirit of the loyalty test suite (Q24).
- A `Recipient` parameter exists from day one with a single `OwnDevices` value, so eri-social extends rather than forks the egress.

### Accepted risks

- **Projection over-disclosure.** The projection is the only operator-decryptable world-model content; a gap in the sensitivity gate leaks private facts to the server-readable tier. Mitigation: fail-closed gate (5), CI invariant tests, the Claude sensitivity pass above the keyword floor, and keeping the projection small (less surface). Revisit the gate before any real user data syncs.
- **Staleness confusion.** Eventually-consistent recall can answer from an out-of-date projection. Mitigation: the contract is explicit (4); deep/live questions relay to the computer; a freshness timestamp can ride the projection so the phone can say "as of …".
- **Convergence drift.** Running `learned_facts` beside the projection risks two sources disagreeing. Mitigation: blend with a clear precedence (brain projection wins on facts/entities), and retire `learned_facts` once coverage is proven (Phase C), per [[feedback_additive_over_cutover]].

## Alternatives rejected

- **Phone calls the brain live.** A serverless function reaching into the user's local (or enclave) brain per turn — impossible within the Vercel budget and breaks computer-off. The pre-computed projection is the point.
- **A sibling `recall_projection` table.** A second server-readable store beside Tier-A duplicates the sync, the `K_server` handling, and the sensitivity gate. Extending the one Tier-A `Profile` keeps one boundary to secure.
- **Real-time cross-device sync.** Implying live freshness would require the phone to block on the computer (defeating phone-only) or a streaming sync (new infra). Eventually-consistent + relay is honest and fits the constraints.
- **A general recipient-agnostic egress.** Letting the projection leave for "whoever asks" is exactly the loyalty boundary we must not cross; the gate is recipient-parameterized so outward sharing is always an explicit, stricter policy.
