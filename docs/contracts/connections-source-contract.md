# Connections source — fetch contract (for the phone/website window)

> The brain's auto-index "dreaming" loop (Phase 2 #5, ADR-0012) PULLS normalized
> connected-account observations from this endpoint, Q23-screens them, and ingests
> them into the world model. The brain half (pull + screen + ingest + reflect) is
> built and tested; this endpoint is the one piece in the website lane. Build it to
> this contract and the live loop closes.

## The endpoint

```
GET /api/v1/connections/observations?since=<ms>&limit=<n>
Auth: Bearer eri_sk_…   (single-principal — the caller's OWN connected accounts only)
```

**PASS-THROUGH, never a store.** Fetch the bearer's Gmail / Calendar live via the
existing Composio plumbing (`lib/proactive/signals.ts` already does the fetch),
normalize to texts, return them. **Raw bodies are persisted NOWHERE** on the website
side — the endpoint reads Composio and forwards; it does not write a row. (Data lives
nowhere = nothing to leak.)

## Response (200)

```jsonc
{
  "observations": [
    { "sourceId": "gmail:<msgId>", "text": "Email from Priya Nair: atlas launch sync — can we move standup?", "kind": "email",    "ts": 1750000000000 },
    { "sourceId": "gcal:<eventId>", "text": "Standup with Sam, Priya about atlas at 9:00am",                  "kind": "calendar", "ts": 1750000600000 }
  ],
  "nextCursor": 1750000600000   // ms cursor to resume from; null = no more
}
```

- `sourceId` — stable per item (`"gmail:<id>"` / `"gcal:<id>"`). The brain's idempotency
  + provenance key, so re-fetching never duplicates. **Must be stable across calls.**
- `text` — **metadata + snippet only**, normalized to one line:
  - email → `"Email from <from>: <subject> — <snippet?>"`
  - calendar → `"<title> with <attendees?> at <time>"`
  - No full bodies, no attachments, no raw HTML.
- `kind` — `"email"` | `"calendar"` (extensible).
- `ts` — event time, ms epoch (received / start).
- `nextCursor` — opaque-ish ms cursor; `null` (or absent) when the window is exhausted.
  The brain pages until `nextCursor` is null, the page is empty, or its cap is hit.

Empty/absent fields are fine. Honour `limit` (the brain caps spend by paging in
bounded chunks). An unconnected account simply contributes nothing (not an error).

## What the brain does with it (so the contract is mutual)

1. Pages `since` → `nextCursor`, bounded by a hard `max_observations` cap (recent-N).
2. **Q23-DROPS** any observation whose `text` trips `looks_sensitive`
   (credential / financial / health / intimate) **before it is stored** — ADR-0012.
   So even if a sensitive snippet comes through, it never enters the world model. (You
   still shouldn't send obvious secrets — defense in depth, both sides.)
3. Ingests the survivors (entities + relations) idempotently by `sourceId`, then runs
   ONE batched reflect pass for the cue-less entities.

## Not in scope

- **Writes / persistence on the website side.** Read-through only.
- **Cross-principal.** Strictly the bearer's own connections (same posture as
  `/memory/recall`, ADR-0010 §hard-guarantees).
