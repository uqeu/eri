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

> **Status (2026-06-25):** the four **world-model fields** (`entities`,
> `relations`, `recentObservations`, `predictions`) are live as of the gathering
> facade. The **`profile`** field is **empty until the sync slice lands** — it's
> composed from the existing Tier-A distill at push time. Don't rely on `profile`
> yet; the phone's existing `personalization_profiles` remains the style/preference
> source until then (which the blend already does).

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

## Push integration — confirm before the trigger goes live (producer → server)

The brain pushes via `push_recall`, riding the **existing** `ProfileTransport`
(same `EriApiClient`, same endpoint, same server-side **K_server**-at-rest + AAD=
`user_id`). The body it sends is the projection JSON in §1 (the same shape you
read). The push capability is built; the **sync-tick trigger is NOT wired yet** —
on purpose, because sending the projection body to the current Tier-A endpoint
could break the *working* profile sync that feeds live phone personalization.

**One thing for the phone window to confirm, then we wire it:**

- **Does the existing Tier-A endpoint ignore unknown fields?**
  - **Yes** → the brain pushes a `ProfileBody`-**superset**: the current
    `profile` / `dynamic_context` fields stay exactly where the server expects
    them, and the world-model fields ride along (stored encrypted, read by the
    phone). Non-breaking; the trigger is then a one-liner on the brain side.
  - **No (strict validation)** → stand up a **sibling endpoint** with the SAME
    K_server + AAD=`user_id` binding; the brain pushes the projection there. Same
    encryption, distinct path — never a weaker one.

Either way the server is confirmed before the trigger goes live. Don't migrate the
existing profile push until the phone reads the projection (strangler-fig).

## Not in scope here

- **Outward sharing.** The projection's egress is `OwnDevices` only. A future
  consented "share a slice with a person/eri" (eri-social) is a *different recipient*
  on the same egress gate (ADR-0010 §7) — not part of this contract.
- **Writes.** This is a read contract. The phone learns via its own path (which
  converges into the brain over Phases B–C); it does not write the projection.
