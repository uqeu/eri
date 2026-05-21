# eri Zed-Strip Phase 1 Result

## Outcome

Phase 1 deleted **1 crate** for **858 LoC** removed. Workspace members went from **501 → 500**.

The strip-plan's Phase-1 hit list was designed assuming the LLM provider crates were true leaves. They are not: every provider (`anthropic`, `open_ai`, `google_ai`, `deepseek`, `mistral`, `lmstudio`, `ollama`, `open_router`, `bedrock`, `x_ai`) is consumed in the source of `language_models` and several other strip-list crates (each has a `crates/language_models/src/provider/<name>.rs` with concrete type/function refs, not just `use` lines). Deleting them requires the AI/Agent stack rewrite — that is Phase 2 work, not Phase 1.

## Results table

| Crate | Result |
|---|---|
| x_ai | Skipped — language_models has a full `provider/x_ai.rs` module using `x_ai::Model`, `x_ai::XAI_API_URL` |
| zed_env_vars | Skipped — `db` (KEEP) and `agent` reference it; deletion broke manifests |
| eval_utils | Skipped — `agent`/`agent_ui` use `eval_utils` in test-support; deleting cascades into source |
| anthropic | Skipped — source-level deps in `copilot_chat`, `edit_prediction_cli`, `language_models`, `language_models_cloud` |
| open_ai | Skipped — source-level deps in `edit_prediction`, `edit_prediction_cli`, `language_models`, `language_models_cloud` |
| google_ai | Skipped — source-level deps in `agent_servers`, `language_models`, `language_models_cloud`, `opencode` |
| deepseek | Skipped — source-level dep in `language_models` (provider impl) |
| mistral | Skipped — source-level dep in `language_models` |
| lmstudio | Skipped — source-level dep in `language_models` |
| ollama | Skipped — source-level dep in `language_models` |
| open_router | Skipped — source-level dep in `language_models` |
| bedrock | Skipped — source-level dep in `language_models` |
| vercel | Skipped — crate does not exist (already removed earlier) |
| snippet_provider | Skipped — `json_schema_store` (KEEP) depends on it |
| auto_update | Skipped — `activity_indicator` (KEEP) and `title_bar` (KEEP) depend on it |
| auto_update_ui | Skipped — only consumer is `zed`, but block-deleted alongside `auto_update`/`crashes` cascade |
| **auto_update_helper** | **Deleted (858 LoC)** — separate Windows updater binary, no Rust dependents |
| feedback | Skipped — block-deleted with the cascade above |
| crashes | Skipped — `remote_server` and `zed` use `crashes` source paths; deletion exposes `sentry` references in `zed/src/main.rs` |

## Crates deleted

- `crates/auto_update_helper/` — 858 LoC

## Workspace member count

- Before: 501
- After: 500

## Verification

`cargo check --workspace --exclude eri_app --exclude zed` finishes cleanly. The `eri_app` and `zed` binaries have **pre-existing** breakage unrelated to this pass (uncommitted edits in `crates/zed/src/main.rs` reference `sentry::init` and `eri_telemetry::track` without those names being in scope; `crates/eri_app/src/window.rs` calls `.new()` on `&mut Context`). Those crates were already broken at session start — the initial `cargo check` reported clean only because the incremental target dir cached them. Anything that touches those two crates should be deferred until that source is fixed.

## Surprises in reverse-dep checks

`cargo tree -i -p <crate>` reports a crate as having no reverse deps when nothing in the active dep graph reaches it from a buildable target. That is misleading here: it returns "no users" for crates that are still referenced from `workspace.dependencies` consumers (e.g. `agent_servers` declares `google_ai.workspace = true` and uses it in source, but `agent_servers` itself isn't on a build path that tree explores by default). The real test is `grep -l "^<crate>\s*=\|^<crate>\.workspace\|\"<crate>/" crates/*/Cargo.toml`. Every Batch B and most Batch C crates failed that test.

## Next batch (Phase 2)

The strip plan's Phase 2 is the right next move because the AI/Agent stack is the choke point. Until those crates are removed, none of the LLM-provider leaves can be deleted.

Recommended order — delete consumer first, providers fall after:

1. `agent`, `agent_ui`, `agent_servers`, `agent_settings`, `agent_skills`, `ai_onboarding`
2. `acp_thread`, `acp_tools`, `action_log`, `prompt_store`, `rules_library`, `zeta_prompt`, `context_server`
3. `copilot`, `copilot_chat`, `copilot_ui`
4. `language_model`, `language_model_core`, `language_models`, `language_models_cloud`
5. `cloud_api_client`, `cloud_api_types`, `cloud_llm_client`, `aws_http_client`
6. `edit_prediction`, `edit_prediction_cli`, `edit_prediction_context`, `edit_prediction_metrics`, `edit_prediction_types`, `edit_prediction_ui`
7. `web_search`, `web_search_providers`
8. After all of the above are gone: **the Phase-1 leaves are now real leaves and can be deleted** — `anthropic`, `open_ai`, `google_ai`, `deepseek`, `mistral`, `lmstudio`, `ollama`, `open_router`, `bedrock`, `x_ai`, `codestral`, `vercel`, `opencode`.
9. After `extension_cli` and `project` are stripped: `snippet_provider`.
10. After `zed` is replaced by `eri_app` and `activity_indicator`/`title_bar` are slimmed: `auto_update`, `auto_update_ui`, `feedback`, `crashes`.
11. Also clear at any time (very small leaves still pending verification): `eval_cli`, `eval_utils`, `schema_generator`, `docs_preprocessor`, `component_preview`, `component`, `etw_tracing`, `explorer_command_injector`, `windows_resources`, `nc`, `gpui_windows`, `gpui_linux`, `gpui_web`, `zlog`, `zlog_settings`, `ztracing`, `ztracing_macro`, `csv_preview`, `svg_preview`, `markdown_preview`, `image_viewer`, `journal`, `zed_env_vars` — most of these have at least one strip-list-bound consumer whose source has to be touched first.

## Fix the pre-existing zed breakage before Phase 2

Phase 2 cannot validate `cargo check --workspace` cleanly until either:
- the user reverts the modifications to `crates/zed/src/main.rs`, or
- `sentry` and `eri_telemetry` are added as proper dependencies in `crates/zed/Cargo.toml`, or
- those references are routed through `eri_app`, and `zed` is removed from `default-members`.

Same for `crates/eri_app/src/window.rs` — calls to `.new()` on `&mut Context` need to be resolved against the current `gpui` API.
