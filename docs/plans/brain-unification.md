# Plan: One eri brain, many surfaces (P2 + P4) — for Ultraplan refinement

> **Status:** drafted 2026-06-18 for Ultraplan refinement before execution. Large, multi-runtime, deploy-gated — do NOT one-shot. Companion to ADR-0005 and the architecture review (`/var/folders/.../architecture-review-20260618-*.html`). Memory: `project_eri_brain_unification`.

## Context

An `improve-codebase-architecture` review (3 Explore agents, 2026-06-18) found eri is **two brains, one identity** — contradicting CONTEXT.md ("phone eri = the cloud half of the one brain") and the 2026-06-16 cloud pivot:

- **Desktop brain (Rust):** `eri_cli::build_agent::drive_build_loop` / `control_agent::drive_control_loop`; persona `eri_inference/brand.rs`; local memory `~/.eri/memory.json`; local sessions `~/.config/eri/sessions/*.json`.
- **Phone brain (TS):** `website/lib/agent/run_core.ts::runAgentTurn` — a **full second agent loop** (own `BASE_PERSONA`, own tool dispatch, own model call); conversation in Supabase `conversation_turns`; pgvector + Voyage-rerank recall.
- **Shared today:** only memory facts + Tier-A profile (Supabase), Tier-B blob, the `command_queue`.
- **Duplicated/split:** the loop, persona, communication-style learner, recall engine, tool surface.
- **Cross-device conversation continuity: does not exist.** Desktop sessions are local files; phone history is a separate cloud table; they never meet. "Talk on laptop, continue on phone" is impossible.

**Already shipped (P1 — desktop gets the phone's tools, local, no deploy):** `web_search` tool (reuses `research::search_web_via_proxy`), `get_weather` tool (Open-Meteo), and email/calendar/Notion already reachable via the Composio Tool-Router tier (control + build loops). Desktop ≈ phone on tools now.

**Goal:** one brain that every surface is a thin client of — talk on laptop or phone, it knows the same things, **continues the same conversation across devices**, and is **proactive** (calendar-aware reminders). The user explicitly wants the literal "one module; surfaces just talk to it."

---

## P2 — One conversation (cross-device continuity + resume)

**Outcome:** a single cloud-primary conversation both surfaces append to and read, so a laptop chat continues on the phone (Claude-style session resume) and eri offers a handoff ("want to keep going on your phone?").

**Seam.** One `Conversation` module with a tiny interface: `append(userId, sessionId?, turn)`, `recent(userId, sessionId?, limit, window)`, `list(userId)`, `resume(sessionId)`. Today this is split: `crates/eri_cli/src/session.rs` (+ `chat.rs`) write local JSON; `website` reads `conversation_turns` (migration 0022). Unify on the cloud store.

**Build.**
- Extend `conversation_turns` (or a `sessions` table) keyed by `(user_id, session_id)`; add a session-list endpoint `GET /api/v1/sessions` + `GET /api/v1/sessions/:id`.
- Desktop `chat.rs`: after each turn, **also** append the turn to the cloud conversation (best-effort, alongside local JSON for offline). Add `eri chat --resume <cloud-session>` that pulls cloud turns.
- Phone: already reads `conversation_turns`; add a `resume_session` path + a session picker ("continue [name] / start fresh").
- Handoff nudge: when the user signals they're leaving the laptop (or a meeting is near), eri offers to continue on the phone.

**Decision for Ultraplan:** conversation sensitivity. Phone reads `conversation_turns` server-side (plaintext) today. Either keep the shared conversation **server-readable** (like Tier-A, simplest) or **E2E** (like Tier-B, but then the cloud/phone can't read it without device-side decrypt). Pick one; it shapes the whole sync path.

**Proactive tie-in (the user's calendar-reminder ask).** Extend the existing proactive loop (`website/lib/proactive/`, the `/api/v1/proactive/trigger` cron): read the user's calendar (Composio), and a few minutes before a meeting, message them ("starts in 5 — here's what you said you'd prep"). Calendar-aware reminders = proactive + the shared conversation context.

**Verification:** laptop turn → phone `recent()` sees it → continue mid-thread; `eri chat --resume` rehydrates a phone-started conversation; cron fires a reminder before a seeded calendar event.

---

## P4 — The loop collapse (cloud is THE brain; desktop = actuation client)

**Outcome:** ONE agent loop (the cloud brain) that both surfaces send turns to. Local-only powers (computer-use, files, screen) become **tools the brain dispatches back** to the desktop via the `command_queue` seam that already exists (ADR-0002). The desktop's Rust loop is **demoted** to: (1) the actuation/perception client the brain calls back into, and (2) an offline fallback.

**Why this is the big one.** It spans **two runtimes** (Rust + TS), the **cloud**, and a **migration of two live loops into one** — with real tension against local-first / offline / latency / token-cost. Must be incremental and reversible.

**Approaches (for Ultraplan to choose/refine):**
- **(A) Cloud brain is the loop (recommended — what the user asked for).** Desktop "smart"/conversational turns route to the same cloud agent endpoint the phone uses; the brain dispatches local tools back via `command_queue`; the Rust loop stays only for actuation + offline. True single module.
- **(B) Shared contract, two loops.** Keep both loops but unify persona + tool registry + conversation + recall behind shared specs/endpoints so they're behaviorally identical. Lower risk, but it's "two clones kept honest" — not the literal one module.

**Existing seams to build on:** `command_queue` (phone→desktop dispatch, already polled by the desktop), the inference proxy (`website/lib/inference/proxy.ts`), the shared memory (Supabase), `classify_reach(goal)` (Api/Local/Mixed — the routing signal).

**Incremental migration (A):**
1. Stand up a cloud agent endpoint that runs the one loop (generalize `run_core.ts` into the canonical brain; fold in the desktop's tool contract).
2. Route desktop **non-actuation** turns to it; keep computer-use/files local as callback tools.
3. Unify persona (kill `brand.rs` vs `BASE_PERSONA` drift — one source) and the tool registry (local vs cloud tags) — P3 folds in here.
4. Deprecate the Rust conversational loop; Rust keeps actuation + perception + offline fallback.

**Risks + mitigations:** offline (keep the local loop as fallback; degrade gracefully); latency (cloud round-trip — acceptable per the cloud pivot; cache); token cost (all reasoning → cloud, already the pivot's intent); breaking live flows (feature-flag the cloud-route, roll per surface).

**Verification:** identical persona/voice across surfaces (assert the assembled system blocks match for a turn); a desktop conversational turn produces the same answer shape as the phone; computer-use still works (dispatched back); offline desktop degrades to the local fallback without crashing; green gates (`cargo test --workspace`, clippy, website `tsc`/tests).

---

## Sequencing + gates

1. **P2 first** (one conversation) — highest felt value (resume across devices), self-contained on the cloud side, unblocks the handoff + proactive reminders. Needs: a migration + new API routes + a deploy.
2. **P4 second** (loop collapse) — the structural unification; P3 (one persona + one tool registry) folds into it.
3. Each phase ships green (Rust workspace + website `tsc`/tests) and behind a flag; reversible.
4. Deploy gating: migrations applied to prod Supabase + Vercel env + branch merged to `main` (currently 228 commits behind — a real release).

**Hand to Ultraplan to:** pick the conversation-sensitivity model (P2), choose approach A vs B and detail the migration (P4), and decide the offline/latency story before any code.
