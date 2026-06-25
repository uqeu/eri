# Recall projection — read contract (for the phone window)

> The finalized consumer-half contract for `recall(userId)`. Authoritative shape +
> semantics; the producer (Rust brain) and consumer (serverless phone) agree here.
> Decisions behind it: **ADR-0010** (recall seam) + ADR-0001 (Tier-A/B) + ADR-0008
> (confidential cloud). The phone window owns the read + blend; the brain owns the
> projection + push. **This doc is the seam between them — review the consumer half
> against it.**

## What `recall(userId)` returns

A bounded projection of the user's world model, read from the **server-readable
Tier-A store** the phone already reads (the brain pre-computes and pushes it; the
phone never calls the brain live):

```jsonc
{
  "version": 1,
  "userId": "<the caller's own user_id>",
  "asOf": 1750000000000,            // ms epoch — when the brain last pushed this projection
  "entities": [
    { "id": "...", "kind": "person|project|app|topic|place|life_event",
      "name": "Priya", "salience": 7 }      // salience = evidence/co-occurrence count
  ],
  "relations": [
    { "src": "Priya", "dst": "atlas",        // names match `entities[].name`
      "kind": "works_with|collaborates_on|owns|uses|part_of" }
  ],
  "recentObservations": [
    { "text": "Paired with Priya on atlas", "ts": 1749990000000, "kind": "fact" }
  ],
  "predictions": [
    { "after": "open editor", "next": "run tests", "count": 4 }   // "after X you usually Y"
  ],
  "profile": {                         // the existing Tier-A profile, returned alongside
    "facts": ["..."], "preferences": ["..."],
    "communicationStyle": "...", "dynamicContext": "..."
  }
}
```

Empty/absent fields are valid (a fresh user projects `[]` / empty `profile`).

> **Status (2026-06-25):** **all fields are live.** The four world-model fields
> (`entities`, `relations`, `recentObservations`, `predictions`) come from the
> gathering facade; the **`profile`** field is composed from the existing Tier-A
> distill at push time. The brain now pushes the full projection on every sync tick
> (`eri sync` and the post-write best-effort sync), so the phone's `recall(userId)`
> reflects the last push (`asOf`). The phone's existing `personalization_profiles`
> stays a blend fallback (strangler-fig), but `profile` is no longer empty.

## Field semantics

| field | from (brain) | use on the phone |
|---|---|---|
| `entities` | key people / projects / apps, salience-ranked | who/what eri knows; top-N only |
| `relations` | edges between the projected entities | "who do I work with on X" |
| `recentObservations` | the live "right now" slice | grounding the current reply |
| `predictions` | learned `next`-step chains (count ≥ 2) | proactive "after X you usually Y" |
| `profile` | existing Tier-A distill | style/register + static facts |

`relations` only references entities present in `entities` (no dangling).

## Hard guarantees the phone can rely on

1. **Already sensitivity-gated (fail-closed).** The projection NEVER contains
   health / financial / intimate / credential content, or anything the brain's gate
   was unsure about — that gate is the confidential→server-readable boundary
   (ADR-0010 §5). The phone still treats the projection as the user's private data
   (it's `K_server`-at-rest, AAD=`user_id`), but does not need to re-screen it.
2. **Single-principal.** `userId` is the caller's own id; the phone reads ONLY the
   authenticated caller's row (same `eri_sk_*` bearer, own-`user_id`-rows only, per
   ADR-0002). There is no cross-principal read.
3. **Eventually-consistent — NOT real-time.** The phone answers from the
   **last-pushed** projection (`asOf`). That is what makes phone-only / computer-off
   work. Anything needing live freshness (a deep memory lookup, a just-now fact)
   **relays to the running computer** via the command queue (ADR-0002) — do not
   imply real-time sync to the user; "as of `asOf`" is honest framing when relevant.

## Blend guidance (Phase A — strangler-fig, ADR-0010 §8)

Today the phone has `learned_facts` + `personalization_profiles`. `recall(userId)`
**blends** the brain projection beside them — no cutover:

- **Brain projection wins on facts/entities/relations/predictions** (it's the
  canonical source of truth). Treat `learned_facts` as a fallback/cache for
  coverage the projection doesn't yet have.
- `personalization_profiles` (style/register) and `profile.communicationStyle`
  converge — prefer the brain's `profile` where present.
- Retire the standalone `learned_facts` only once the projection demonstrably
  covers it (Phase C). Until then, blend; never drop the phone's store.

## Push integration — RESOLVED + wired (producer → server)

**Decision (2026-06-25): the SIBLING endpoint.** The phone window confirmed the
existing Tier-A profile PUT is *lossy* — it stores only `JSON.stringify(body.profile)`,
so a `ProfileBody`-superset would have **silently dropped every world-model field**
(200-OK, projection gone). So the projection rides its own path:

- **`PUT /api/v1/memory/recall`** (`0029_recall_projections`, RLS-locked), with the
  **same** server-side **K_server**-at-rest encryption + AAD=`user_id` as the profile
  route. Distinct path, identical encryption — never a weaker one. The working profile
  sync is untouched.
- The brain pushes via `recall::push_recall`, over a dedicated `RecallTransport`
  (a separate type from `ProfileTransport`, so the lossy profile endpoint is
  *unrepresentable* as a recall target). The body is the **exact §1 camelCase shape**
  (`asOf`, `recentObservations`, `communicationStyle`, …) the route's
  `coerceRecallProjection` validates — a snake_case key would be silently coerced to
  empty, so the wire field names are locked by a regression test.
- **Trigger: wired on the sync tick** (`eri sync` + the post-write best-effort sync),
  after the Tier-A profile push. The projection is gated once more right before it
  leaves; `asOf` carries the eventually-consistent stamp.

Strangler-fig preserved: the profile push is unchanged and still feeds phone
personalization; the recall projection is additive beside it.

## Not in scope here

- **Outward sharing.** The projection's egress is `OwnDevices` only. A future
  consented "share a slice with a person/eri" (eri-social) is a *different recipient*
  on the same egress gate (ADR-0010 §7) — not part of this contract.
- **Writes.** This is a read contract. The phone learns via its own path (which
  converges into the brain over Phases B–C); it does not write the projection.
