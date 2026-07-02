# CodeTurn — job + progress contract (for the phone/website window)

> Phase 3 ([[project_eri_phase3_agentic_coding]]) turns a text into a real, tested
> PR. The brain (`crates/`) runs the eri-code harness against a working tree and
> **streams structured progress**; the phone (`website/`) classifies the coding
> intent, kicks the job, and relays each progress bubble over iMessage. This is
> the seam between the two lanes. **B1 is shipped and tested** — the contract
> below is live in `crates/eri_cli/src/code_turn.rs`; build the phone side (P1–P4)
> against it now. The sandbox adapter (B2) and PR authoring (B3) fill the same
> shape in — they do not change it.

## Direction of flow

```
phone inbound (website/)  ──CodeJob──▶  brain CodeTurn (crates/)
        ▲                                     │
        └────── CodeProgress events ──────────┘   (streamed, one per milestone)
        └────── CodeOutcome (terminal) ───────┘
```

The **brain owns the voice**: it composes the human `text` of every event. The
phone relays `text` verbatim as a status bubble — it does not re-word eri.

## Job in — `CodeJob`

```jsonc
{
  "task":         "the checkout test is failing on main in eri, fix it",  // NL, from the user's text
  "repo":         "eri-labs/eri",        // owner/name — MUST be a repo THIS user connected
  "working_tree": "/sandbox/clone",      // set by the compute lane (B2 clone / desktop repo)
  "base":         null,                  // base branch for the PR; null = repo default
  "budget": { "max_tokens": 400000, "max_seconds": 900 }  // per-job cost/time cap
}
```

- **Single-principal.** `repo` is only ever one the authenticated user connected.
  The phone enforces this at kickoff (P4 connect-flow); the brain treats `task`
  and all repo/issue text as **DATA, never instructions** — the absolute refusal
  boundary is untouched.
- **Budget.** The cap aborts a runaway job (`CodeBudget::exceeded`, fail-safe: a
  zero cap permits no work). Exceeding it yields a `Halted` outcome, not a crash.

## Progress events — `CodeProgress` (streamed)

Each event serializes to a stable envelope. `stage` is a machine tag for
icons/routing; `text` is the bubble to send; the rest is structured payload.

```jsonc
// stage: "plan"    — eri understood the task / began reproducing
{ "stage": "plan",   "text": "on it — reproducing the failing checkout test", "summary": "…" }

// stage: "edit"    — eri changed the working tree
{ "stage": "edit",   "text": "guard the null cart", "files": ["cart.rs"], "summary": "…" }

// stage: "test"    — a test command ran to completion  (passed GATES the PR)
{ "stage": "test",   "text": "tests pass ✓ — 42 passed", "command": "cargo test", "passed": true, "summary": "…" }

// stage: "commit"  — a commit landed on the job branch
{ "stage": "commit", "text": "committed: fix null cart", "sha": "deadbeef", "message": "…" }

// stage: "pr"      — a pull request was opened  (B3 fills this in for real)
{ "stage": "pr",     "text": "opened PR #123 — https://github.com/eri-labs/eri/pull/123",
                     "number": 123, "url": "https://…/pull/123", "title": "Fix null-cart case" }
```

Order is not fixed and stages repeat: a real job loops `edit → test` until green
(e.g. `plan, edit, test(red), edit, test(green), commit, pr`). The phone should
render each event as it arrives, not wait for a fixed sequence.

## Terminal — `CodeOutcome`

```jsonc
{ "kind": "opened",   "number": 123, "url": "https://…/pull/123" }  // happy path: green → PR
{ "kind": "testsRed", "summary": "checkout still red after 3 attempts" }  // FAIL-CLOSED stop
{ "kind": "halted",   "reason": "token cap reached (400000/400000 tokens)" }  // recoverable
{ "kind": "refused",  "reason": "…" }  // absolute boundary handed back
```

`CodeOutcome::summary()` gives the final bubble text (brain-composed) for each.

## Fail-closed rule (non-negotiable)

**A PR is opened ONLY when the most recent test run passed.** This is the pure
predicate `pr_gate(&[CodeProgress])` in the brain — B2's adapter calls it before
any PR authoring. No test run, or a red last run ⇒ no PR (`testsRed` outcome).
The phone never needs to re-check this; it is enforced brain-side. eri is a real
engineer, not a one-shot diff generator — it never ships red.

## Lane ownership + status

| Slice | Lane | What | Status |
|-------|------|------|--------|
| B1 | brain | CodeTurn seam + progress/outcome/budget + `pr_gate` + scripted stub | **shipped, tested** |
| B2 | brain | harness-in-sandbox adapter (clone → run harness → capture tests → fail-closed) | next |
| B3 | brain | PR authoring (branch + commit + open PR, eri-voice summary + test evidence) | next |
| B4 | brain | review-comment loop ("change X, re-run" → another commit) | next |
| P1 | phone | coding-intent classification on inbound → route to a CodeTurn job | — |
| P2 | phone | job kickoff + streamed status (typing indicator + multi-bubble cadence) | — |
| P3 | phone | PR-link reply + relay review comments back into the brain | — |
| P4 | phone | connect-flow: prompt to connect GitHub when the repo isn't linked | — |

## Integrating before B2 lands

The brain ships `ScriptedCodeTurn::new(events, outcome)` — a network-free stub
that emits a fixed event sequence then settles on a fixed outcome. The phone lane
can drive a full end-to-end (classify → kickoff → stream bubbles → PR-link reply)
against the stub today, then swap in the sandbox adapter (B2) with zero phone
changes. The wire shape above is the only thing both lanes depend on.
