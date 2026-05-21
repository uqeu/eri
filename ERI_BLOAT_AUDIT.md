# ERI Bloat Audit

_Research-only. No code was modified._

---

## Section 1: Overlapping Crates

### Token estimation: three independent `chars/4` estimators

| Location | Function | Method |
|---|---|---|
| `crates/eri_caveman/src/eri_caveman.rs:98` | `estimate_tokens(text)` | `chars().count() / 4` |
| `crates/eri_inference/src/costs.rs:34` | `CLAUDE_CHARS_PER_TOKEN = 4.0`, used in `claude_code_estimated_cost` | char len / 4 |
| (no `eri_tokens` crate exists in the workspace) | — | — |

**Finding:** There is no `eri_tokens`/tiktoken crate. The audit prompt assumed one existed — it does not. Both `eri_caveman::estimate_tokens` and `costs::claude_code_estimated_cost` independently implement the same `chars/4` heuristic. They serve different callers (caveman uses it for compression telemetry; costs uses it for dollar estimation when the CLI doesn't return token counts), but the underlying constant and formula are duplicated.

**Recommendation:** Extract a single `pub fn estimate_tokens_heuristic(text: &str) -> u32` into `eri_core` (already the shared data-types crate). Both `eri_caveman` and `eri_inference::costs` import it. No new crate needed.

### `eri_caveman` vs `eri_graph`: distinct, not redundant

`eri_caveman` strips filler words from prose. `eri_graph` converts HTML→TOON structural compression. Their inputs and outputs are orthogonal. No merge recommended.

### `eri_cache` / `eri_index`: no overlap found

`eri_cache` is a cross-session KV memoization store. `eri_index` is a semantic code search index. Separate concerns.

---

## Section 2: EriIteratorPanel Field Consolidation

`crates/eri_ui/src/eri_ui.rs` is **8,400 lines** — 10× the 800-line project limit. The `EriIteratorPanel` struct has approximately **60 top-level fields**. Grouping by responsibility:

### Current (flat) field inventory

| Group | Fields | Notes |
|---|---|---|
| Sidecar state (camera) | `camera_process`, `camera_status`, `camera_point`, `camera_reader_task`, `camera_preview`, `camera_restart_count`, `camera_started_at` | 7 fields per sidecar × 4 sidecars |
| Sidecar state (voice) | `voice_capture`, `voice_status`, `voice_reader_task`, `voice_restart_count`, `voice_started_at` | — |
| Sidecar state (TTS) | `tts_process`, `tts_status`, `tts_ready`, `tts_reader_task`, `last_spoken_draft`, `tts_restart_count`, `tts_started_at` | — |
| Sidecar state (brain) | `brain_process`, `brain_status`, `brain_ready`, `brain_reader_task`, `brain_restart_count`, `brain_started_at` | — |
| Cost / spending | `session_mercury_cost`, `session_mercury_edit_cost`, `session_claude_cost`, `session_tts_chars`, `session_prompt_tokens`, `session_completion_tokens`, `session_reasoning_tokens`, `session_total_tokens`, `cost_guard` | 9 fields |
| Predictive-fire | `last_partial_inference_at`, `last_partial_fired_text`, `predictive_fire_armed`, `pending_candidate_text`, `pending_candidate_first_seen`, `inference_seq`, `inference_started_at`, `inference_first_token_at` | 8 fields |
| Inline rewrite | `pending_inline_patch`, `pending_rewrite_task`, `rewrite_seq`, `cmd_k_editor`, `cmd_k_subscription` | 5 fields |
| Recording | `recording_process`, `recording_path`, `last_recording_path`, `recording_started_at` | 4 fields |
| Social thread | `last_social_thread`, `last_deploy_url`, `social_thread_task`, `social_thread_cancel` | 4 fields |
| Bug finder | `current_bugs`, `bug_finder_task`, `bug_finder_cancel`, `bug_finder_status` | 4 fields |
| Polish/ship-it | `polish_status`, `polish_task`, `polish_cancel`, `agent_backend`, `vercel_available` | 5 fields |
| Voice-clone wizard | `voice_clone_process`, `voice_clone_reader_task` | 2 fields |
| Scrubber/iteration log | `iteration_counter`, `current_iteration_index`, `last_fired_prompt`, `last_applied_patch` | 4 fields |
| Misc UI | `preview_process`, `preview_stdin`, `preview_width`, `server_process`, `server_status`, `camera_preview`, `browser_opened_this_session`, `sidecar_watchdog` | 8 fields |

### Proposed grouped sub-structs: 60 fields → ~15

```rust
struct SidecarState {
    process: Option<Child>,
    reader_task: Option<Task<()>>,
    status: SharedString,
    ready: bool,
    restart_count: u32,
    started_at: Option<Instant>,
}
// Use: camera: SidecarState, tts: SidecarState, brain: SidecarState
// (voice is slightly different — uses VoiceCapture, not Child — keep separate or extend)

struct SessionCosts { /* 9 cost fields */ }
struct PredictiveFire { /* 8 predictive-fire fields */ }
struct InlineRewrite { /* 5 inline-rewrite fields */ }
struct BackgroundFeature<T> { task: Option<Task<()>>, cancel: Arc<AtomicBool>, status: SharedString, data: Option<T> }
// Covers: polish, social_thread, bug_finder, voice_clone
```

**Impact:** Reduces `EriIteratorPanel` from ~60 top-level fields to ~15 named groups. The `new()` initializer (currently 90+ lines of field assignments) shrinks proportionally. Dead field risk (fields zeroed but never read after a feature ships) also drops because each sub-struct is either fully present or absent.

---

## Section 3: ControlCommand Variants to Merge

Full count: **43 variants** in `eri_core::ControlCommand` (lines 350–583).

| Merge target | Variants | Rationale |
|---|---|---|
| Unified accept | `Accept` + `AcceptPatch` | Both mean "yes, apply the pending thing". Disambiguate by checking `pending_inline_patch.is_some()` in the handler, not with two variants. |
| Unified reject | `Reject` + `RejectPatch` | Same reasoning. |
| Unified undo | `Undo` + `RevertToCommit("last")` | `Undo` is a special-case of `RevertToCommit` pointing at HEAD-1. Make `Undo` an alias that populates `RevertToCommit("last")`. |
| Unified list | `ListProjects` + `ListTemplates` + `ListMcpTools` | All three emit a status line. Could become `ListItems(ListTarget)` where `ListTarget` is an enum. Reduces match arm count by 2. |
| Unified toggle | `EnableMcp` + `DisableMcp` | `SetMcp(bool)` is cleaner and removes one variant. |
| Unified spend | `PauseSpending` + `ResumeSpending` | `SetSpending(bool)` — same pattern. |

**Net reduction:** 43 → ~36 variants (save 7). Low priority compared to the sidecar abstraction, but each merge eliminates a dead-code warning risk when a feature is toggled.

---

## Section 4: Sidecar Abstraction Proposal

Four sidecars (`camera`, `tts`, `brain`, `voice_clone`) share identical lifecycle code across 8,400 lines:

1. Spawn subprocess → pipe stdout → parse JSON lines → `cx.notify()`
2. On death: check restart count ≤ `SIDECAR_MAX_RESTARTS`, log, sleep `SIDECAR_RESTART_BACKOFF_MS`, respawn
3. Expose `is_running()` via `try_wait()`

Each is currently ~150–300 lines of per-sidecar copy-paste with only the script path, status strings, and `handle_*_sidecar_line` handler differing.

### Proposed abstraction (sketch)

```rust
// In eri_ui or a new eri_sidecar crate
struct SubprocessSidecar {
    script_path: PathBuf,
    name: &'static str,
    process: Option<Child>,
    reader_task: Option<Task<()>>,
    restart_count: u32,
    started_at: Option<Instant>,
}

impl SubprocessSidecar {
    fn start<F>(&mut self, cx: &mut Context<impl Entity>, on_line: F)
    where F: Fn(&str) -> SidecarUpdate + Send + 'static;

    fn is_running(&mut self) -> bool;

    fn maybe_restart<F>(&mut self, cx: &mut Context<impl Entity>, on_line: F);
}

enum SidecarUpdate {
    Status(SharedString),
    Ready,
    NotReady,
    IgnoreStderrLine,
}
```

This reduces the four start/watchdog/restart function clusters (~1,200 lines total) to one generic implementation + four 10-line callsites. **Highest-impact consolidation in the codebase.**

---

## Section 5: System-Prompt Audit

All prompts live in `crates/eri_inference/src/eri_inference.rs`.

| Constant | Lines | Scope | Redundancy? |
|---|---|---|---|
| `SYSTEM_PROMPT` (private) | 1928–2033 (~105 lines) | Base Mercury system prompt — full-file build, iteration discipline, surgical diff rules, design principles, image guidance, game rules | No redundancy; this is the main prompt |
| `SURGICAL_SYSTEM_PROMPT` (private) | 2315–2340 (~25 lines) | Tool-call path (Mercury + `edit_html` tool) for targeted edits | Does NOT contradict `SYSTEM_PROMPT` — different endpoint |
| `APPLY_SNIPPET_SYSTEM_PROMPT` (private) | 2347–2370 (~23 lines) | Apply-path snippet generator for Mercury Edit 2 `/v1/apply/completions` | Does NOT contradict — different endpoint |
| `SHADCN_COMPONENT_HINTS` (pub) | 2042–2058 (~16 lines) | Component class strings layered onto every build | Overlaps with design hints in `SYSTEM_PROMPT` (both mention shadcn buttons/cards) — minor duplication but at different granularity |
| `MOTION_PRESETS` (pub) | 2267–2301 (~34 lines) | Motion preset snippets, injected on `AddMotion` command | No conflict |
| `MOTION_DIRECTIVE_BLOCK` (pub) | 2302–2314 (~12 lines) | Template block that wraps `MOTION_PRESETS` | No conflict; it's a wrapper |
| `SHIP_IT_SEO_RULES` (pub) | 3109–3120 (~11 lines) | Claude Code CLI ship-it prompt | No conflict with Mercury prompts; different model/path |
| `SHIP_IT_A11Y_RULES` (pub) | 3128–3136 (~9 lines) | Accessibility checklist for ship-it | No conflict |
| `SHIP_IT_PRODUCTION_RULES` (pub) | 3141–3147 (~7 lines) | Production cleanup rules for ship-it | No conflict |
| `SHIP_IT_DESIGN_HINTS` (pub) | 3154–3160 (~7 lines) | Design polish hints for ship-it | Overlaps with design section of `SYSTEM_PROMPT` AND `SHADCN_COMPONENT_HINTS` — the Unsplash photo URL pattern, shadcn button style, and typographic scale appear in all three |

**Real redundancy:** `SHIP_IT_DESIGN_HINTS` and `SHADCN_COMPONENT_HINTS` both reference shadcn button markup and Unsplash photo patterns that already appear in `SYSTEM_PROMPT`. The duplicated copy can drift (already: `SYSTEM_PROMPT` says `rounded-full` buttons; `SHADCN_COMPONENT_HINTS` says `rounded-md`). These should be extracted to shared constants rather than inlined separately.

---

## Section 6: Priority Ranking

| Rank | Consolidation | Estimated LOC saved | Risk-of-bug reduction |
|---|---|---|---|
| 1 | **Sidecar abstraction** (Section 4) | ~1,000 lines | High — 4× copy-pasted restart loops; a bug fix applied to one sidecar won't propagate to others |
| 2 | **EriIteratorPanel sub-structs** (Section 2) | ~300 lines of initializer + field declarations | High — 60 flat fields means accidental use of the wrong `*_status`/`*_process` field is compiler-silent; sub-structs give namespacing |
| 3 | **Split eri_ui.rs** (implied by Section 2) | N/A lines saved, but enables review | High — 8,400-line file is well beyond project 800-line limit; concurrent edits by agents collide |
| 4 | **Deduplicate token estimator** (Section 1) | ~5 lines | Low — both estimators are correct; risk is future maintenance drift |
| 5 | **Consolidate ControlCommand variants** (Section 3) | ~30 lines | Medium — `Accept` vs `AcceptPatch` disambiguation is a future source of user-visible bugs if a third "accept" concept is added without updating every handler |

