# ADR-0001: eri's memory — adopt SOTA patterns into the Rust store, not a Python engine; two-tier sync

- Status: Accepted
- Date: 2026-06-14
- Context: [[project_phone_eri]] plan (`/Users/khai/.claude/plans/i-want-that-phone-cached-lagoon.md`)

## Context

"Phone eri" needs the cloud to know the user (so it can answer like their eri), while the
computer eri's memory must sync across devices and stay private. We surveyed the leading
agent-memory engines (Zep/Graphiti, mem0, supermemory, Letta/MemGPT, Cognee) and the
context-engineering SOTA. eri is a Rust workspace + Next.js/Supabase cloud, local-first and
token-frugal; it already has the memory *core*: hybrid semantic+lexical+recency recall,
recency decay, `eri_caveman` token budgeting, and prompt caching.

## Decision

1. **Adopt patterns, not a Python service.** Keep one Rust memory seam (`eri_inference::memory`).
   Do not vendor Zep/mem0/supermemory (all Python services). Adopt their patterns:
   - **Tiers** (Letta): a small always-resident core/working block + recall + archival.
   - **Bi-temporal facts** (Zep/Graphiti): `valid_from`/`valid_to` + `learned_at`; on change,
     invalidate-not-delete — enables "yesterday vs today vs right now" without recompute.
   - **extract→update→retrieve + static/dynamic profile + supersession + forgetting**
     (mem0 + supermemory).
   - **Per-`user_id` tag isolation** (supermemory): isolation by construction.
   Rust-native engines (AgenticMemory MIT, YantrikDB MIT-MCP) are fallbacks only if
   reimplementing the temporal graph proves too costly — re-evaluate, don't assume.

2. **Two-tier sync.** Tier-A = a small (≤32KB) **server-readable** personalization profile
   (static facts + live `dynamic_context`), Claude-sensitivity-gated, encrypted at rest with a
   server key `K_server` — this is the only memory the cloud can read, and only a *projection*,
   never the raw log/secrets. Tier-B = the **full memory blob, E2E-encrypted** with `K_user`
   (HKDF over a stored per-user salt, not the rotating bearer), via the existing `memory_blobs`
   path; the cloud cannot read it. Deep/private questions from phone eri **relay to the running
   computer eri** (which holds `K_user`).

3. **Token-frugality upgrades** layered on the existing core (ranked): token-budgeted recall,
   tool-based memory (agent calls `recall` during reasoning), episodic→semantic consolidation,
   contradiction/supersession, MMR diversity, a core/working block, 1h prompt-cache TTL.

## Consequences

- No Python runtime dependency; memory stays in-process + offline-capable + Rust-testable.
- The cloud can personalize phone eri without holding the user's full memory in cleartext.
- We must implement merge (LWW by `ts_ms` + dedup by `id` + tombstones for `/forget`) and the
  bi-temporal fields ourselves; `forget()` becomes a tombstone (hard-delete breaks sync).
- Standing task: re-scan the memory landscape; revisit if a Rust-native, permissive, bi-temporal
  engine matures.

## Alternatives rejected

- **Vendor a Python memory service** (mem0/Zep self-host): adds a runtime, breaks local-first +
  offline, splits the memory seam across languages.
- **Strict E2E only** (cloud never reads memory): phone eri can't personalize unless the computer
  is online; worse UX. (Offered as a user-selectable mode, not the default.)
