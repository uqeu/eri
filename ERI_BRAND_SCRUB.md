# eri Brand Scrub

> Goal: nothing user-visible traces back to "Zed" when someone opens eri code.
> This is the BRAND scrub, not the code-deletion pass. The strip agent removes
> the dead crates; we hide the wordmark wherever it would touch a human.

## Reference counts (case-sensitive "Zed")

| Category | Approx. count | Notes |
|---|---|---|
| All Rust/JSON/TOML/MD/PLIST refs (full repo) | ~3,500 | dominated by `crates/zed/` internals and code-owned comments |
| Refs outside `crates/` (root docs, root Cargo.toml) | ~40 | mostly `README.md`, handoff docs, architecture docs |
| Refs inside `crates/eri_*` | 9 | all internal comments referencing the legacy shell; no user-visible strings |
| User-visible strings (top surfaces) | ~30 | enumerated below |
| App-bundle metadata (`[package.metadata.bundle-*]`) | already eri-branded | done previously |
| macOS `Permissions.plist` strings | already eri-branded | done previously |
| App menu (`zed/src/zed/app_menus.rs`) | already eri-branded | done previously |
| Onboarding (`crates/onboarding/`) | already says "Welcome to eri" | done previously |

## Top 30 user-visible strings that must change before eri ships

Status legend: `[x] DONE` (executed in this pass) · `[~] DEFERRED` (left for the strip-agent because the surrounding crate is doomed) · `[!] BLOCKED` (in-flight file).

| # | File | Line | Old → New | Status |
|---|---|---|---|---|
| 1 | `README.md` | 1–46 | "# Zed" + intro + sponsorship → eri intro, eri loop, eri-branded build instructions | `[x] DONE` |
| 2 | `crates/ui/src/components/label/label.rs` | 369 | `"Welcome to Zed"` → `"Welcome to eri"` (component story example) | `[x] DONE` |
| 3 | `crates/recent_projects/src/remote_servers.rs` | 1988 | `"Open Zed Log"` → `"Open eri Log"` | `[x] DONE` |
| 4 | `crates/agent_ui/src/agent_ui.rs` | 359 | `NativeAgent` label `"Zed Agent"` → `"eri Agent"` | `[x] DONE` |
| 5 | `crates/agent_ui/src/agent_panel.rs` | 4240 | `ContextMenuEntry::new("Zed Agent")` → `"eri Agent"` | `[x] DONE` |
| 6 | `crates/zed/resources/info/DocumentTypes.plist` | 22 | `Zed Text Document` → `eri Text Document` | `[x] DONE` |
| 7 | `crates/zed/resources/zed.desktop.in` | 6, 12 | high-perf multiplayer editor → "Voice-first diffusion IDE."; `Keywords=zed;` → `Keywords=eri;` | `[x] DONE` |
| 8 | `crates/eri_app/Cargo.toml` | bundle metadata | added `[package.metadata.bundle]` for the eri binary (name, identifier, descriptions) | `[x] DONE` |
| 9 | `crates/ai_onboarding/src/ai_onboarding.rs` | 157, 187, 224 | `"Welcome to Zed AI"` x3 | `[~] DEFERRED` — entire `ai_onboarding` crate is on the Phase-1 strip list |
| 10 | `crates/ai_onboarding/src/ai_onboarding.rs` | 307, 324, 341 | `"Welcome to Zed Pro / Business / Student"` | `[~] DEFERRED` — paid Zed plans, irrelevant to eri; will be deleted with crate |
| 11 | `crates/zed/src/main.rs` | window title path | the legacy Zed bin's window title (separate from `eri_app`) | `[~] DEFERRED` — `crates/zed/` directory itself is the strip-agent's job |
| 12 | `crates/eri_app/src/main.rs` | 1–10 | doc-comments mention "the legacy Zed shell" (devs only, not users) | `[!] BLOCKED` — file flagged as in-flight; left a `TODO(brand-scrub)` is unnecessary because there are no user-visible Zed strings, only dev comments |
| 13 | `crates/feedback/` action `OpenZedRepo` and `feedback::EmailZed` | various | action names referenced from menus (the menu LABEL is "eri Repository" already, only action symbol still says Zed) | `[~] DEFERRED` — symbol rename is a refactor, not a brand scrub; user doesn't see it |
| 14 | `crates/agent/src/agent.rs` `ZED_AGENT_ID` | 2064 | `AgentId::new("Zed Agent")` constant | `[~] DEFERRED` — used as a stable telemetry ID; renaming risks breaking server-side analytics; the strip agent owns this |
| 15 | `crates/auto_update/src/auto_update.rs` | 1050 | `temp_dir.path().join("Zed")` | `[~] DEFERRED` — auto-update path on disk, not user-visible; auto_update is on the strip list |
| 16 | `crates/context_server/src/context_server.rs` | 140 | MCP client `name: "Zed"` | `[~] DEFERRED` — protocol identifier sent to remote MCP servers; renaming may break existing handshakes |
| 17 | `crates/context_server/src/oauth.rs` | 677 | `"client_name": "Zed"` | `[~] DEFERRED` — OAuth client name registered with providers; brand-rename is a coordinated rollout, not a string flip |
| 18 | `crates/dap/src/client.rs` | 321 | DAP `client_name: Some("Zed".to_owned())` | `[~] DEFERRED` — DAP protocol identifier; eri may not even ship a debugger |
| 19 | `crates/project/src/debugger/dap_command.rs` | 1538 | `client_name: Some("Zed".to_owned())` | `[~] DEFERRED` — same as #18 |
| 20 | `crates/language_model_core/src/provider.rs` | 21 | `LanguageModelProviderName::new("Zed")` provider id | `[~] DEFERRED` — provider id, plumbed deep; rename is a separate refactor |
| 21 | `crates/etw_tracing/etw_tracing.rs` | 233, 268 | Windows ETW instance name "Zed", recorder author "Zed Industries" | `[~] DEFERRED` — Windows-only telemetry, low surface; etw_tracing crate slated for strip |
| 22 | `crates/git/src/repository.rs` | 3677–4137 | `GIT_AUTHOR_NAME` / `GIT_COMMITTER_NAME` literal `"Zed"` for stash-style commits | `[~] DEFERRED` — affects on-disk git history; coordinated change |
| 23 | `crates/windows_resources/src/windows_resources.rs` | 47, 97, 98 | Windows file metadata `CompanyName "Zed Industries"`, `LegalCopyright Zed`, `("app-icon.ico", "Zed")` | `[~] DEFERRED` — Windows-only resource bundle; needs eri legal entity name from owner before scrubbing |
| 24 | `crates/livekit_client/examples/test_app.rs` | 38 | example app menu `Menu::new("Zed")` | `[~] DEFERRED` — example file only, not shipped |
| 25 | `crates/gpui_linux/src/linux/x11/clipboard.rs` | 2 | source-file copyright header `Copyright 2022 - 2025 Zed Industries, Inc.` | `[~] DEFERRED` — license attribution, must NOT be stripped (it's a copyright notice on inherited code, removing it is a license violation) |
| 26 | `Cargo.toml` (root) | 1006, 1014 | comments "shipping code to Zed" / "Zed can surface clippy errors" | `[~] DEFERRED` — workspace-level comments, devs only |
| 27 | `crates/zed/resources/zed.desktop.in` | 13–14 | comment lines referencing "Zed" in upstream PR context | `[~] DEFERRED` — comments only, not rendered in the .desktop entry |
| 28 | `ERI_CLAUDE_HANDOFF.md`, `ERI_IDE_ARCHITECTURE.md`, `ERI_ZED_STRIP_LIST.md` | many | dev-facing docs that intentionally talk about the Zed→eri transition | `[~] INTENTIONAL` — these docs MUST mention Zed to describe what's being removed |
| 29 | `crates/zed/src/zed/app_menus.rs` | 312 | `MenuItem::action("Email Us...", zed_actions::feedback::EmailZed)` | `[x] LABEL-OK` — menu label is already "Email Us...", only the action symbol is `EmailZed` (not user-visible) |
| 30 | `crates/zed/src/zed/app_menus.rs` | 320 | `MenuItem::action("eri Repository", feedback::OpenZedRepo)` | `[x] LABEL-OK` — menu label is already "eri Repository", action symbol `OpenZedRepo` is internal |

## Asset replacement

eri's own assets (in repo today):
- `/Users/khai/Desktop/eri/assets/icons/eri-text-black.png`
- `/Users/khai/Desktop/eri/assets/icons/eri-text-white.png`
- `/Users/khai/Desktop/eri/assets/icons/logo-black.svg`
- `/Users/khai/Desktop/eri/assets/icons/eri.svg`

Files in `crates/zed/resources/` that need to be replaced with eri assets before shipping (NOT done in this pass — these are binary artifacts that need a designer):

| Asset | Where it ships | What to replace with |
|---|---|---|
| `crates/zed/resources/app-icon.png` (`@2x.png`) | macOS / Linux app icon, stable channel | rasterized `logo-black.svg` at 512px and 1024px |
| `crates/zed/resources/app-icon-dev.png` (`@2x.png`) | Dev channel | same, with a "dev" overlay (designer) |
| `crates/zed/resources/app-icon-nightly.png` (`@2x.png`) | Nightly channel | same, with "nightly" overlay |
| `crates/zed/resources/app-icon-preview.png` (`@2x.png`) | Preview channel | same, with "preview" overlay |
| `crates/zed/resources/Document.icns` | macOS document type icon | regen from eri docs icon |
| `crates/zed/resources/windows/*.ico` | Windows resources | regen from eri logo |
| `crates/zed/resources/flatpak/*.svg` | Linux flatpak | regen from eri logo |
| `crates/zed/resources/snap/*` | Linux snap | regen |

Once these are replaced, the bundle metadata in `crates/zed/Cargo.toml` already points at filenames `app-icon*.png` so no path changes are needed — just swap the bytes.

For the new `eri_app` bundle: create `assets/icons/eri-app-icon.icns` (currently commented out in `crates/eri_app/Cargo.toml`) so `cargo bundle -p eri_app` picks it up.

## Out of scope (per the brief)

- Renaming `crates/zed/` directory → breaks too many import paths; leave for the strip agent's final pass.
- Renaming the `zed` package in `crates/zed/Cargo.toml` → same.
- Deleting Zed's PNG assets → leave; new eri PNGs replace them in-place when the designer hands them off.
- Touching code inside `collab/`, `vim/`, `agent/` internals → all on the strip list anyway.
- Source-file copyright headers → keep them; stripping them is a license violation while the code is still in-tree.

## Verification

- `cargo check -p eri_app` fails at workspace-resolve time with a missing `eval_utils` workspace dependency. This is a **pre-existing** breakage from in-flight strip work on `agent_ui/Cargo.toml` — not caused by anything in this scrub. All edits in this pass are string-level inside existing string literals; none change module imports or types.
- Files changed in this pass:
  - `/Users/khai/Desktop/eri/README.md`
  - `/Users/khai/Desktop/eri/crates/ui/src/components/label/label.rs`
  - `/Users/khai/Desktop/eri/crates/recent_projects/src/remote_servers.rs`
  - `/Users/khai/Desktop/eri/crates/agent_ui/src/agent_ui.rs`
  - `/Users/khai/Desktop/eri/crates/agent_ui/src/agent_panel.rs`
  - `/Users/khai/Desktop/eri/crates/zed/resources/info/DocumentTypes.plist`
  - `/Users/khai/Desktop/eri/crates/zed/resources/zed.desktop.in`
  - `/Users/khai/Desktop/eri/crates/eri_app/Cargo.toml`
