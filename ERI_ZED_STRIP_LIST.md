# eri Zed Strip List

Research-only inventory. No deletions performed. Verdicts assume eri's product is a voice + gaze + Mercury diffusion IDE with a single-file HTML/JS preview surface — not a typed-language editor, not a collab tool, not an LSP client, not a debugger.

LoC = total lines under `crates/<name>/**/*.rs` from `find ... | xargs wc -l`. Approximate.

---

## Section 1 — Inventory (Zed crates only; eri_* crates omitted from strip review)

| Crate | LoC | Category | Verdict |
|---|---:|---|---|
| acp_thread | (sm) | ai_agent | STRIP |
| acp_tools | (sm) | ai_agent | STRIP |
| action_log | (sm) | ai_agent | STRIP |
| activity_indicator | 783 | theme_ui | KEEP |
| agent | 71,617 | ai_agent | STRIP |
| agent_servers | 5,053 | ai_agent | STRIP |
| agent_settings | 1,772 | ai_agent | STRIP |
| agent_skills | 1,451 | ai_agent | STRIP |
| agent_ui | 67,372 | ai_agent | STRIP |
| ai_onboarding | 905 | ai_agent | STRIP |
| anthropic | 2,176 | ai_agent | STRIP (use eri_inference) |
| askpass | 494 | vcs | STRIP (with collab/lsp) |
| assets | n/a | os_integration | REPLACE (eri_app owns assets) |
| audio | 1,183 | collab_call | STRIP |
| auto_update | 1,548 | os_integration | REPLACE (eri update channel) |
| auto_update_helper | 858 | os_integration | REPLACE |
| auto_update_ui | 437 | os_integration | REPLACE |
| aws_http_client | 104 | ai_agent | STRIP |
| bedrock | 1,303 | ai_agent | STRIP |
| breadcrumbs | 127 | editor_surface | KEEP (cheap, useful) |
| buffer_diff | 4,032 | editor_surface | KEEP (Mercury inline rewrites use it) |
| call | 3,001 | collab_call | STRIP |
| channel | 1,929 | collab_call | STRIP |
| chat_panel | — (folded into collab_ui) | collab_call | STRIP |
| cli | 1,592 | tooling_meta | REPLACE (eri_cli already exists) |
| client | 5,679 | collab_call | REPLACE (eri auth + telemetry only) |
| clock | 338 | gpui_core | KEEP |
| cloud_api_client | 519 | ai_agent | STRIP |
| cloud_api_types | 536 | ai_agent | STRIP |
| cloud_llm_client | 426 | ai_agent | STRIP |
| codestral | 424 | ai_agent | STRIP |
| collab | 43,282 | collab_call | STRIP |
| collab_ui | 6,410 | collab_call | STRIP |
| collections | (sm) | gpui_core | KEEP |
| command_palette | 1,507 | editor_surface | REPLACE (eri_palette) |
| command_palette_hooks | (sm) | editor_surface | REPLACE |
| component | 534 | tooling_meta | STRIP |
| component_preview | 1,206 | tooling_meta | STRIP |
| context_server | (med) | ai_agent | STRIP (eri_mcp owns this) |
| copilot | 3,315 | ai_agent | STRIP |
| copilot_chat | 2,187 | ai_agent | STRIP |
| copilot_ui | 754 | ai_agent | STRIP |
| crashes | 535 | tooling_meta | KEEP (sentry already wired) |
| credentials_provider | 34 | os_integration | KEEP |
| csv_preview | 2,081 | editor_surface | STRIP |
| dap | 2,800 | lsp_lang | STRIP |
| dap_adapters | 3,130 | lsp_lang | STRIP |
| db | 1,010 | os_integration | KEEP (sqlez-backed local state) |
| debug_adapter_extension | 243 | lsp_lang | STRIP |
| debugger_tools | 1,168 | lsp_lang | STRIP |
| debugger_ui | 25,199 | lsp_lang | STRIP |
| deepseek | 341 | ai_agent | STRIP |
| denoise | (sm) | collab_call | STRIP |
| dev_container | 14,269 | os_integration | STRIP |
| diagnostics | 5,047 | lsp_lang | STRIP |
| docs_preprocessor | 957 | tooling_meta | STRIP |
| edit_prediction | 13,409 | ai_agent | STRIP (Mercury Edit 2 replaces) |
| edit_prediction_cli | 16,085 | ai_agent | STRIP |
| edit_prediction_context | 2,459 | ai_agent | STRIP |
| edit_prediction_metrics | 6,008 | ai_agent | STRIP |
| edit_prediction_types | 380 | ai_agent | STRIP |
| edit_prediction_ui | 3,772 | ai_agent | STRIP |
| editor | 148,506 | editor_surface | FREEZE + STRIP (vendor, rip LSP/collab) |
| editor_benchmarks | (sm) | tooling_meta | STRIP |
| encoding_selector | 470 | editor_surface | STRIP |
| env_var | 40 | os_integration | KEEP |
| etw_tracing | 670 | os_integration | STRIP (mac-only product) |
| eval_cli | 726 | tooling_meta | STRIP |
| eval_utils | 146 | tooling_meta | STRIP |
| explorer_command_injector | 199 | os_integration | STRIP (Windows-only) |
| extension | 2,706 | tooling_meta | STRIP |
| extension_api | 1,155 | tooling_meta | STRIP |
| extension_cli | 472 | tooling_meta | STRIP |
| extension_host | 10,051 | tooling_meta | STRIP |
| extensions_ui | 2,457 | tooling_meta | STRIP |
| feature_flags | 916 | tooling_meta | KEEP (eri uses gates) |
| feature_flags_macros | 190 | tooling_meta | KEEP |
| feedback | 145 | collab_call | REPLACE (eri-branded) |
| file_finder | 6,691 | editor_surface | KEEP |
| file_icons | 166 | theme_ui | KEEP |
| fs | 6,695 | os_integration | KEEP |
| fs_benchmarks | 34 | tooling_meta | STRIP |
| fuzzy | 1,209 | editor_surface | KEEP |
| fuzzy_nucleo | 1,654 | editor_surface | KEEP |
| git | 6,717 | vcs | KEEP (auto-commit feature) |
| git_graph | 6,220 | vcs | STRIP |
| git_hosting_providers | 4,200 | vcs | STRIP |
| git_ui | 26,264 | vcs | STRIP |
| go_to_line | 1,313 | editor_surface | KEEP |
| google_ai | 1,158 | ai_agent | STRIP |
| gpui | 63,002 | gpui_core | KEEP (the win) |
| gpui_linux | (med) | gpui_core | STRIP (mac-only v1) |
| gpui_macos | (med) | gpui_core | KEEP |
| gpui_macros | (sm) | gpui_core | KEEP |
| gpui_platform | (med) | gpui_core | KEEP |
| gpui_shared_string | (sm) | gpui_core | KEEP |
| gpui_tokio | (sm) | gpui_core | KEEP |
| gpui_util | (sm) | gpui_core | KEEP |
| gpui_web | (med) | gpui_core | STRIP (Mac-only v1) |
| gpui_wgpu | (med) | gpui_core | KEEP |
| gpui_windows | (med) | gpui_core | STRIP |
| grammars | 108 | lsp_lang | STRIP |
| html_to_markdown | (sm) | tooling_meta | STRIP |
| http_client | 1,083 | os_integration | KEEP |
| http_client_tls | 21 | os_integration | KEEP |
| icons | 297 | theme_ui | KEEP |
| image_viewer | (sm) | editor_surface | STRIP |
| input_latency_ui | 322 | tooling_meta | STRIP |
| inspector_ui | 962 | tooling_meta | STRIP |
| install_cli | 122 | os_integration | KEEP |
| journal | 300 | editor_surface | STRIP |
| json_schema_store | (med) | settings_schema | KEEP |
| keymap_editor | 5,840 | settings_schema | STRIP (eri ships fixed keymap v1) |
| language | 21,702 | lsp_lang | STRIP |
| language_core | 1,903 | lsp_lang | REPLACE (need minimal Rope+Buffer) |
| language_extension | 830 | lsp_lang | STRIP |
| language_model | 1,913 | ai_agent | STRIP |
| language_model_core | (sm) | ai_agent | STRIP |
| language_models | 14,490 | ai_agent | STRIP |
| language_models_cloud | 1,004 | ai_agent | STRIP |
| language_onboarding | 100 | lsp_lang | STRIP |
| language_selector | 770 | lsp_lang | STRIP |
| language_tools | 5,129 | lsp_lang | STRIP |
| languages | 14,010 | lsp_lang | STRIP |
| line_ending_selector | 271 | editor_surface | STRIP |
| livekit_api | 302 | collab_call | STRIP |
| livekit_client | 3,991 | collab_call | STRIP |
| lmstudio | 511 | ai_agent | STRIP |
| lsp | 2,414 | lsp_lang | STRIP |
| markdown | 9,446 | editor_surface | KEEP (used by eri_ui for help/about) |
| markdown_preview | 1,526 | editor_surface | STRIP |
| media | (med) | collab_call | STRIP |
| menu | 37 | gpui_core | KEEP |
| migrator | 8,664 | settings_schema | STRIP (eri starts clean) |
| miniprofiler_ui | 772 | tooling_meta | STRIP |
| mistral | 472 | ai_agent | STRIP |
| multi_buffer | 16,289 | editor_surface | KEEP (editor depends on it) |
| nc | 51 | os_integration | STRIP |
| net | 442 | os_integration | KEEP |
| node_runtime | 1,024 | lsp_lang | STRIP |
| notifications | 689 | collab_call | STRIP |
| ollama | 816 | ai_agent | STRIP |
| onboarding | 2,246 | tooling_meta | REPLACE (eri has its own 4-step) |
| open_ai | 4,903 | ai_agent | STRIP |
| open_path_prompt | (sm) | editor_surface | KEEP |
| open_router | 814 | ai_agent | STRIP |
| opencode | (med) | ai_agent | STRIP |
| outline | 1,190 | editor_surface | STRIP |
| outline_panel | 8,171 | editor_surface | STRIP |
| panel | 35 | theme_ui | KEEP |
| paths | 611 | os_integration | KEEP |
| picker | 1,565 | theme_ui | KEEP |
| platform_title_bar | 1,246 | os_integration | KEEP |
| prettier | 1,219 | lsp_lang | STRIP |
| project | 91,871 | editor_surface | FREEZE + STRIP (remove collab/LSP) |
| project_benchmarks | (sm) | tooling_meta | STRIP |
| project_panel | 18,990 | editor_surface | STRIP (eri uses single project model) |
| project_symbols | 613 | lsp_lang | STRIP |
| prompt_store | 1,442 | ai_agent | STRIP |
| proto | 1,616 | collab_call | STRIP |
| recent_projects | 8,080 | editor_surface | KEEP (slimmed) |
| refineable | 680 | settings_schema | KEEP |
| release_channel | 240 | os_integration | KEEP |
| remote | 6,930 | collab_call | STRIP |
| remote_connection | 728 | collab_call | STRIP |
| remote_server | 5,580 | collab_call | STRIP |
| repl | 11,993 | editor_surface | STRIP |
| reqwest_client | 323 | os_integration | KEEP |
| rope | 4,405 | editor_surface | KEEP |
| rpc | 2,732 | collab_call | STRIP |
| rules_library | 1,341 | ai_agent | STRIP |
| scheduler | 2,120 | gpui_core | KEEP |
| schema_generator | 43 | tooling_meta | STRIP |
| search | 10,149 | editor_surface | KEEP |
| session | 149 | os_integration | KEEP |
| settings | 7,833 | settings_schema | REPLACE (eri_settings is leaner) |
| settings_content | 9,737 | settings_schema | STRIP |
| settings_json | 2,635 | settings_schema | KEEP |
| settings_macros | 152 | settings_schema | KEEP |
| settings_profile_selector | (sm) | settings_schema | STRIP |
| settings_ui | 20,141 | settings_schema | STRIP |
| shell_command_parser | 1,928 | terminal_pty | KEEP |
| sidebar | 18,477 | theme_ui | REPLACE (eri sidebar is custom) |
| snippet | 334 | editor_surface | STRIP |
| snippet_provider | 464 | editor_surface | STRIP |
| snippets_ui | 364 | editor_surface | STRIP |
| sqlez | 2,612 | os_integration | KEEP |
| sqlez_macros | 102 | os_integration | KEEP |
| streaming_diff | 1,104 | editor_surface | KEEP (Mercury rewrite diffs) |
| sum_tree | 3,327 | editor_surface | KEEP |
| svg_preview | 365 | editor_surface | STRIP |
| syntax_theme | 336 | theme_ui | KEEP |
| system_specs | 297 | os_integration | KEEP |
| tab_switcher | 1,488 | editor_surface | KEEP |
| task | 2,999 | terminal_pty | STRIP (no task runner v1) |
| tasks_ui | 1,932 | terminal_pty | STRIP |
| telemetry | 66 | tooling_meta | REPLACE (eri_telemetry) |
| telemetry_events | 126 | tooling_meta | STRIP |
| terminal | 6,656 | terminal_pty | KEEP (Claude Code CLI handoff) |
| terminal_view | 9,641 | terminal_pty | KEEP |
| text | 6,492 | editor_surface | KEEP |
| theme | 5,744 | theme_ui | KEEP |
| theme_extension | 92 | theme_ui | STRIP |
| theme_importer | 820 | theme_ui | STRIP |
| theme_selector | 1,201 | theme_ui | STRIP (eri ships one theme) |
| theme_settings | 2,200 | theme_ui | KEEP |
| time_format | 1,117 | gpui_core | KEEP |
| title_bar | 2,878 | theme_ui | KEEP (slimmed; no collab status) |
| toolchain_selector | 1,433 | lsp_lang | STRIP |
| ui | 26,413 | theme_ui | KEEP (the design-system win) |
| ui_input | 295 | theme_ui | KEEP |
| ui_macros | 233 | theme_ui | KEEP |
| ui_prompt | 205 | theme_ui | KEEP |
| util | 10,005 | gpui_core | KEEP |
| util_macros | 286 | gpui_core | KEEP |
| vim | 46,415 | vim_modal | STRIP |
| vim_mode_setting | 42 | vim_modal | STRIP |
| watch | 317 | os_integration | KEEP |
| web_search | 72 | ai_agent | STRIP |
| web_search_providers | 163 | ai_agent | STRIP |
| which_key | 420 | editor_surface | STRIP |
| windows_resources | 125 | os_integration | STRIP (mac-only) |
| workspace | 45,887 | editor_surface | FREEZE + REPLACE (eri_app will own) |
| worktree | 11,448 | editor_surface | KEEP |
| worktree_benchmarks | (sm) | tooling_meta | STRIP |
| x_ai | 125 | ai_agent | STRIP |
| zed | 19,997 | eri_proprietary | REPLACE (eri_app is the new shell) |
| zed_actions | (sm) | tooling_meta | KEEP (action enums) |
| zed_credentials_provider | 181 | os_integration | REPLACE (eri credentials) |
| zed_env_vars | 6 | os_integration | STRIP |
| zeta_prompt | 9,714 | ai_agent | STRIP |
| zlog | 1,708 | tooling_meta | STRIP (use `log` + sentry) |
| zlog_settings | 30 | tooling_meta | STRIP |
| ztracing | 109 | tooling_meta | STRIP |
| ztracing_macro | 7 | tooling_meta | STRIP |

**Approximate strippable total: ~830,000 LoC** out of ~1.1M.

---

## Section 2 — Top 20 strip candidates by LoC

| Rank | Crate | LoC | Why strippable | Edge to cut |
|---|---|---:|---|---|
| 1 | editor | 148,506 | Keep functionality but vendor; remove `lsp::*`, `dap::*`, `proto::*`, `collab::*` imports | Replace `pub use lsp` in `editor.rs`; gate `inline_completion` provider trait so it only sees `eri_inference` |
| 2 | project | 91,871 | Same: vendor and rip out remote/LSP/dap | `project::lsp_store`, `project::dap_store`, `project::collab` modules |
| 3 | agent | 71,617 | Zed's AI Agent stack — directly conflicts with eri's brain + Mercury + Claude Code handoff | Remove `agent_ui::init`, `project::AgentRegistryStore::init_global` from main.rs |
| 4 | agent_ui | 67,372 | Same | Tied to `agent`, `language_model`, `acp_thread` |
| 5 | gpui | 63,002 | KEEP — listed for size context only | — |
| 6 | vim | 46,415 | Modal editing not in eri's product (voice IS the modal layer). | Remove `vim::init(cx)` line 784 |
| 7 | workspace | 45,887 | FREEZE: vendor a snapshot, eri_app subsumes most of it | Workspace pane orchestration moves into eri_app |
| 8 | collab | 43,282 | Real-time multi-user collab — Tier 1 backlog at best | Remove `client.rs` collab paths |
| 9 | project_panel | 18,990 | eri shows a single project, single index.html | Remove `project_panel::init` line 762 |
| 10 | sidebar | 18,477 | Replaced by eri's custom right-dock iterator panel | Remove `Sidebar` usages in `zed.rs` |
| 11 | multi_buffer | 16,289 | KEEP — editor depends on it; listed for context | — |
| 12 | edit_prediction_cli | 16,085 | Zeta CLI; Mercury Edit 2 replaces | — |
| 13 | language_models | 14,490 | Provider clients for Anthropic/OAI/Bedrock/etc. eri uses `eri_inference` directly | Drop `language_models::init` line 718 |
| 14 | dev_container | 14,269 | Devcontainer integration — irrelevant to voice-driven prototyping | Remove `dev_container::init` line 744 |
| 15 | languages | 14,010 | Language definitions (TS/Rust/Go/Py grammars). Mercury writes raw HTML; no grammar needed v1 | Remove `languages::init` line 582 |
| 16 | edit_prediction | 13,409 | Zed autocomplete | Remove `edit_prediction::init` line 807 |
| 17 | repl | 11,993 | Jupyter REPL | Remove `repl::init` line 742, `repl::notebook::init` 750 |
| 18 | worktree | 11,448 | KEEP — used by file ops | — |
| 19 | extension_host | 10,051 | Extension runtime; eri does not ship an extension marketplace | Remove `extension_host::init` line 681 |
| 20 | settings_ui | 20,141 | Zed's settings UI; eri uses voice + a 4-step onboarding | Remove `settings_ui::init` line 804 |

Other large wins not in the top 20: `git_ui` (26,264), `debugger_ui` (25,199), `ui` (26,413 — KEEP), `theme` (5,744 — KEEP), `language` (21,702), `keymap_editor` (5,840), `search` (10,149 — KEEP), `markdown` (9,446 — KEEP), `migrator` (8,664).

---

## Section 3 — Top 5 keepers

1. **`crates/gpui/` (63k LoC)** — the framework. Apache-2.0. Hand-rolling another GPU-accelerated immediate-mode-feeling UI framework in Rust is a multi-year effort. This is THE reason to fork Zed and not start from scratch.
2. **`crates/ui/` (26k LoC)** — the design system: buttons, icons, lists, headers, tooltips. The eri_ui crate already builds on it. Replacing would be 6+ months of pure design-system work.
3. **`crates/theme/` (5.7k) + `crates/theme_settings/` (2.2k) + `crates/syntax_theme/` (336)** — color tokens. Cheap to keep, expensive to rebuild. `theme_selector` can be stripped (eri ships one theme).
4. **`crates/editor/` (148k LoC)** — heaviest single crate. Mercury inline rewrites in the editor (already shipped) depend on it. The right move is **FREEZE**: vendor a snapshot, rip out `lsp_store`, `dap`, `inline_completion` provider plumbing for non-eri providers, then never sync upstream again. Cherry-pick bugfixes manually.
5. **`crates/workspace/` (46k LoC)** — high-level Window+Pane+Dock. **FREEZE + REPLACE**: eri_app becomes the bootstrap shell; we keep `workspace`'s pane primitives but rewrite the toolbar/status-bar shells. This is the second-biggest rebuild target after editor.

Also keep (non-negotiable): `gpui_macros`, `gpui_macos`, `gpui_wgpu`, `gpui_platform`, `gpui_shared_string`, `gpui_tokio`, `gpui_util`, `util`, `paths`, `fs`, `db`, `sqlez`, `text`, `rope`, `sum_tree`, `multi_buffer`, `buffer_diff`, `streaming_diff`, `worktree`, `markdown`, `search`, `picker`, `fuzzy`, `fuzzy_nucleo`, `file_finder`, `tab_switcher`, `breadcrumbs`, `terminal`, `terminal_view` (Claude Code handoff), `git` (auto-commit), `crashes`, `release_channel`, `feature_flags`, `http_client`, `reqwest_client`.

---

## Section 4 — Order of operations (5 phases)

### Phase 0 — Verify baseline (no deletions)
- `cargo check --workspace` (capture baseline duration).
- `script/clippy` on `eri_*` crates only.
- Snapshot `cargo tree --workspace --prefix none | sort -u > before.txt`.

### Phase 1 — Leaf strips (zero risk)
Crates with no reverse dependencies in the keep set. **Safe to delete first.**
- `crates/x_ai/`, `crates/codestral/`, `crates/deepseek/`, `crates/mistral/`, `crates/ollama/`, `crates/lmstudio/`, `crates/open_router/`, `crates/bedrock/`, `crates/google_ai/`, `crates/anthropic/`, `crates/open_ai/`, `crates/opencode/` (provider clients — `eri_inference` is the only inference path).
- `crates/csv_preview/`, `crates/svg_preview/`, `crates/markdown_preview/`, `crates/image_viewer/`, `crates/journal/`.
- `crates/zlog/`, `crates/zlog_settings/`, `crates/ztracing/`, `crates/ztracing_macro/`.
- `crates/etw_tracing/`, `crates/explorer_command_injector/`, `crates/windows_resources/`, `crates/nc/`, `crates/gpui_windows/`, `crates/gpui_linux/`, `crates/gpui_web/`.
- `crates/eval_cli/`, `crates/eval_utils/`, `crates/schema_generator/`, `crates/docs_preprocessor/`, `crates/component_preview/`, `crates/component/`.

Check per crate: `cargo tree -p <crate> -i 2>&1 | head` (reverse deps). Delete the directory, remove from `Cargo.toml` `members` and `workspace.dependencies`. Run `cargo check --workspace`.

### Phase 2 — AI/Agent stack
- `agent`, `agent_ui`, `agent_servers`, `agent_settings`, `agent_skills`, `ai_onboarding`.
- `acp_thread`, `acp_tools`, `action_log`, `context_server`, `prompt_store`, `rules_library`, `zeta_prompt`.
- `copilot`, `copilot_chat`, `copilot_ui`.
- `language_model`, `language_model_core`, `language_models`, `language_models_cloud`.
- `cloud_api_client`, `cloud_api_types`, `cloud_llm_client`, `aws_http_client`.
- `edit_prediction*` (all 6 crates).
- `web_search`, `web_search_providers`.

Dependency check: `cargo tree -p agent -i | grep -v eri_`. After: remove init calls 704, 711, 712, 718, 722, 723, 724, 726, 728, 733, 807 from `main.rs`.

### Phase 3 — Collab + Voice (Zed) + Vim
- `collab`, `collab_ui`, `call`, `channel`, `notifications`, `livekit_api`, `livekit_client`, `audio`, `denoise`, `media`.
- `proto`, `rpc`, `remote`, `remote_server`, `remote_connection`.
- `vim`, `vim_mode_setting`.
- `feedback` (replace with eri-branded), `chat_panel` (already inside collab_ui).

After: remove init lines 753, 773, 784, 794, 795, 796, 799.

### Phase 4 — LSP/Lang/Debugger
- `lsp`, `language`, `language_extension`, `language_tools`, `language_selector`, `language_onboarding`, `languages`, `grammars`.
- `dap`, `dap_adapters`, `debug_adapter_extension`, `debugger_ui`, `debugger_tools`, `diagnostics`.
- `prettier`, `toolchain_selector`, `node_runtime`, `project_symbols`, `outline`, `outline_panel`.
- `extension`, `extension_api`, `extension_cli`, `extension_host`, `extensions_ui`.
- `dev_container`, `repl`, `task`, `tasks_ui`.

This phase requires **forking `editor` and `project`** to remove LSP imports. Do it as a vendor step — copy `crates/editor` → `crates/editor` with all `lsp_store`/`completion_provider`/`hover` paths replaced with stubs.

### Phase 5 — Editor + Workspace vendor-strip (the hard one)
- Vendor `editor`, `project`, `workspace` (mark as forked; never sync upstream).
- Strip LSP/DAP/collab modules.
- Replace `inline_completion` provider with `eri_inference::EditPredictionProvider`.
- Move `workspace` bootstrap concerns into `eri_app`.

Test after each phase: `cargo check --workspace && cargo test -p eri_core -p eri_inference -p eri_iterator -p eri_ui`.

---

## Section 5 — Migration shim for `crates/zed/src/main.rs`

Verdict per init call. Line numbers from current `crates/zed/src/main.rs`.

| Line | Call | Verdict | Note |
|---:|---|---|---|
| 203 | `sentry::init` | KEEP | eri uses Sentry |
| 304 | `init_paths()` | KEEP | filesystem layout |
| 310 | `zlog::init` | REPLACE | switch to `log` + `sentry::integrations::log` |
| 313/315 | `zlog::init_output_*` | REPLACE | — |
| 321 | `ztracing::init` | STRIP | |
| 411 | `crashes::init` | KEEP | |
| 508 | `trusted_worktrees::init` | KEEP | |
| 509 | `menu::init` | KEEP | |
| 510 | `zed_actions::init` | KEEP | rename later |
| 512 | `release_channel::init` | KEEP | |
| 513 | `gpui_tokio::init` | KEEP | |
| 517 | `settings::init` | REPLACE | with `eri_settings::init` |
| 518 | `zlog_settings::init` | STRIP | |
| 540 | `git_hosting_providers::init` | STRIP | |
| 544 | `extension::init` | STRIP | |
| 581 | `debug_adapter_extension::init` | STRIP | |
| 582 | `languages::init` | STRIP | |
| 586 | `language_extension::init` | STRIP | |
| 607 | `zed::init` | REPLACE | with `eri_app::init` |
| 609 | `zed::move_to_applications::init` | KEEP | rename |
| 610 | `project::Project::init` | KEEP | (after vendor-strip) |
| 611 | `debugger_ui::init` | STRIP | |
| 612 | `debugger_tools::init` | STRIP | |
| 613 | `client::init` | REPLACE | eri client (auth + telemetry only) |
| 614 | `feature_flags::FeatureFlagStore::init` | KEEP | |
| 677 | `auto_update::init` | REPLACE | eri update channel |
| 678 | `dap_adapters::init` | STRIP | |
| 679 | `auto_update_ui::init` | REPLACE | |
| 680 | `reliability::init` | KEEP | sentry pipeline |
| 681 | `extension_host::init` | STRIP | |
| 689 | `theme_settings::init` | KEEP | |
| 691 | `theme_extension::init` | STRIP | |
| 696 | `command_palette::init` | REPLACE | with `eri_palette::init` |
| 704 | `copilot_chat::init` | STRIP | |
| 711 | `copilot_ui::init` | STRIP | |
| 712 | `language_model::init` | STRIP | |
| 718 | `language_models::init` | STRIP | |
| 719 | `acp_tools::init` | STRIP | |
| 720 | `zed::telemetry_log::init` | REPLACE | eri_telemetry |
| 721 | `zed::remote_debug::init` | STRIP | |
| 722 | `edit_prediction_ui::init` | STRIP | |
| 723 | `web_search::init` | STRIP | |
| 724 | `web_search_providers::init` | STRIP | |
| 725 | `snippet_provider::init` | STRIP | |
| 726 | `edit_prediction_registry::init` | STRIP | |
| 728 | `project::AgentRegistryStore::init_global` | STRIP | |
| 733 | `agent_ui::init` | STRIP | |
| 742 | `repl::init` | STRIP | |
| 743 | `recent_projects::init` | KEEP | |
| 744 | `dev_container::init` | STRIP | |
| 748 | `editor::init` | KEEP | (post-strip) |
| 749 | `image_viewer::init` | STRIP | |
| 750 | `repl::notebook::init` | STRIP | |
| 751 | `diagnostics::init` | STRIP | |
| 753 | `audio::init` | STRIP | |
| 754 | `workspace::init` | KEEP | (post-strip; later folded into eri_app) |
| 755 | `ui_prompt::init` | KEEP | |
| 757 | `go_to_line::init` | KEEP | |
| 758 | `file_finder::init` | KEEP | |
| 759 | `tab_switcher::init` | KEEP | |
| 760 | `outline::init` | STRIP | |
| 761 | `project_symbols::init` | STRIP | |
| 762 | `project_panel::init` | STRIP | |
| 763 | `outline_panel::init` | STRIP | |
| 764 | `eri_ui::init` | KEEP | |
| 771 | `tasks_ui::init` | STRIP | |
| 772 | `snippets_ui::init` | STRIP | |
| 773 | `channel::init` | STRIP | |
| 774 | `search::init` | KEEP | |
| 784 | `vim::init` | STRIP | |
| 785 | `terminal_view::init` | KEEP | Claude Code handoff |
| 786 | `journal::init` | STRIP | |
| 787 | `encoding_selector::init` | STRIP | |
| 788 | `language_selector::init` | STRIP | |
| 789 | `line_ending_selector::init` | STRIP | |
| 790 | `toolchain_selector::init` | STRIP | |
| 791 | `theme_selector::init` | STRIP | (one fixed theme v1) |
| 792 | `settings_profile_selector::init` | STRIP | |
| 793 | `language_tools::init` | STRIP | |
| 794 | `call::init` | STRIP | |
| 795 | `notifications::init` | STRIP | |
| 796 | `collab_ui::init` | STRIP | |
| 797 | `git_ui::init` | STRIP | |
| 798 | `git_graph::init` | STRIP | |
| 799 | `feedback::init` | REPLACE | eri-branded feedback |
| 800 | `markdown_preview::init` | STRIP | |
| 801 | `csv_preview::init` | STRIP | |
| 802 | `svg_preview::init` | STRIP | |
| 803 | `onboarding::init` | REPLACE | eri 4-step onboarding |
| 804 | `settings_ui::init` | STRIP | |
| 805 | `keymap_editor::init` | STRIP | |
| 806 | `extensions_ui::init` | STRIP | |
| 807 | `edit_prediction::init` | STRIP | |
| 808 | `inspector_ui::init` | STRIP | |
| 809 | `json_schema_store::init` | KEEP | |
| 810 | `miniprofiler_ui::init` | STRIP | |
| 811 | `which_key::init` | STRIP | |
| 813 | `etw_tracing::init` | STRIP | |
| 897 | `initialize_workspace` | REPLACE | `eri_app::initialize_workspace` |
| 984 | `component_preview::init` | STRIP | |

Final `main()` should resolve to ~25 init calls (down from ~75), all in eri_app's bootstrap.
