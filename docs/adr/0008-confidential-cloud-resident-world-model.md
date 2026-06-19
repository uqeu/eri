# ADR-0008: the world model is cloud-resident and confidential — canonical brain in the cloud, local cache, per-user LoRA in the enclave

- Status: Accepted (supersedes ADR-0001 §2 on-device-only; hardens the cloud pivot)
- Date: 2026-06-19
- Context: digital-human grill ([[project_eri_digital_human]]). Builds on [[project_eri_cloud_pivot]] (eri is cloud-resident/always-on) and ADR-0004 (hosted brain inference tier).

## Context

eri must work for a **phone-only** user and when the **computer is off** — so a relay-to-running-computer model (ADR-0001 §2) is insufficient as the primary path. The brain has to be always-on, which means cloud-resident. But "yours alone / private" is eri's #1 differentiator, and a plaintext cloud brain would break ADR-0001, the privacy zones (Q23), the loyalty invariant (Q24), and the shipped product promise. The cloud pivot already moved memory cloud-primary; this ADR resolves the resulting privacy tension instead of conceding it.

## Decision

1. **Canonical brain is cloud-resident and confidential.** The world-model graph lives in the cloud so phone-only and computer-off both work. It is **confidential**: stored encrypted and processed only inside a **per-user secure enclave / confidential-compute boundary** (Apple Private Cloud Compute model) so the operator **cannot read it in cleartext**. "Cloud-resident" ≠ "operator-readable." This supersedes ADR-0001 §2's E2E-on-device-only and upgrades the cloud pivot's "server-readable" to "confidential."

2. **Local `eri_graph` is an offline cache/working copy.** When the computer is on, eri reads/writes the local cache for speed + offline use and syncs to the canonical confidential store. Same data model (ADR-0007) both sides; the local SQLite is "eri's local cache of the brain," not the brain.

3. **Tier-A projection still exists, now as a latency/UX optimization, not the privacy boundary.** The privacy boundary is the confidential enclave (everything is private-by-construction inside it); Tier-A remains a small fast projection for cheap turns. Privacy zones (Q23) are enforced inside the boundary; the loyalty egress seam (Q24) still permits only the user's own destinations.

4. **Per-user LoRA trains inside the confidential boundary (P5).** When the graph holds enough high-signal data, a small per-user adapter is trained in the enclave (or on-device when capable) and *augments* the base engine; the graph stays source of truth; enabling is gated on the "day with eri" eval. Data never leaves the confidential boundary (S-LoRA-style serving; [[project_local_engine_tier]]).

## Consequences

- Build order unchanged for slice 1: still build + TDD the graph + entities + recall **locally** (fast, testable). The **next** slice makes the confidential cloud store canonical + adds sync. Only the "canonical home" label + sync are new, not the data model.
- New infra: a confidential-compute boundary (enclave/PCC-style) for the cloud brain + per-user key management; reconcile with ADR-0003 (infrastructure) / ADR-0004 (hosted brain). This is the heavier lift the cloud pivot implies — sequence it after slice 1 proves the model locally.
- Strongest-in-category story: "your whole AI brain, in the cloud, and even we can't read it." Keeps the loyalty test (Q24) green: no plaintext user content is operator-readable.

### Accepted risks

- **Confidential-compute is real engineering** (attestation, key management, enclave ops). Mitigation: local-first for slice 1; treat confidential cloud as its own milestone with a security review before any real user data lands; until then, dev/test uses the local cache only.
- **Sync conflicts** with entities/relations (not just flat observations). Mitigation: extend the existing LWW + tombstone merge (ADR-0001 §consequences) to nodes/edges; entity merges are upserts keyed by canonical id.
