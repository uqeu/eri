# eri — IDE Architecture (VSCodium fork)

> Locked 2026-05-20. Supersedes the earlier "Zed fork + eri_app native shell" plan.

## Why we pivoted

Zed gave us native speed, but two requirements killed the Zed path:

1. **Marketplace.** Users expect 50k+ extensions on day one. Zed's ecosystem is too small.
2. **Visual polish.** Zed's defaults are spartan. To land at "this could pass for a Cursor sibling" we'd be rewriting most of Zed's chrome — at which point we're not really shipping Zed any more.

Cursor proved the model: fork VSCode, reskin, ship the AI panel. Three-year head start that we don't need to relitigate.

## The shape

```
┌──────────────────── eri.app (Electron) ─────────────────────┐
│                                                             │
│   VSCodium fork                                             │
│   ├─ De-Microsoft'd (telemetry off, OpenVSX marketplace)    │
│   ├─ Reskinned to Cursor-aesthetic dark theme               │
│   ├─ Custom activity-bar monogram, AI side panel            │
│   └─ Built-in extension: eri.voice-and-diffusion            │
│                          │                                  │
│                          │  JSON-RPC over stdio             │
│                          ▼                                  │
│   eri-coreutils (one Rust binary, ships in app bundle)      │
│   ├─ eri_voice      (whisper + audio capture)               │
│   ├─ eri_inference  (Mercury 2 streaming + intent classify) │
│   ├─ eri_iterator   (the iteration log + handoff)           │
│   ├─ eri_control    (diffusion preview pipeline)            │
│   ├─ eri_gaze       (gaze tracking sidecar caller)          │
│   ├─ eri_billing    (license + tier check)                  │
│   └─ eri_telemetry  (privacy-respecting metrics)            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

- All `eri_*` Rust crates live, but as a **single sidecar binary** the IDE spawns at launch.
- The IDE extension talks to it over JSON-RPC on stdio. Same pattern as VSCode language servers.
- `eri_app` (the GPUI shell) is **deleted** — replaced by the VSCodium fork.
- `crates/zed` and all the Zed UI/agent/collab crates are **deleted** — they were only valuable as a chrome.

## Repo layout after pivot

```
/Users/khai/Desktop/eri/
├── crates/
│   ├── eri_core/         # shared types
│   ├── eri_voice/        # whisper + audio
│   ├── eri_inference/    # Mercury 2 wire format
│   ├── eri_iterator/     # iteration log
│   ├── eri_control/      # diffusion preview
│   ├── eri_gaze/         # gaze sidecar caller
│   ├── eri_billing/      # license + tier
│   ├── eri_telemetry/    # metrics
│   └── eri_coreutils/    # NEW — main.rs for the sidecar binary
├── website/              # Next.js marketing + dashboard
└── ../eri-ide-fork/      # VSCodium fork (separate working tree)
    ├── patches/
    │   └── eri/          # NEW — eri-specific reskin patches
    └── ...
```

Everything else (`crates/zed`, `crates/eri_ui`, `crates/eri_app`, GPUI shell stuff) gets removed in cleanup.

## Build & ship

1. `eri-ide-fork/` runs VSCodium's existing build pipeline → produces a `eri.app` bundle.
2. `cargo build --release -p eri_coreutils` → produces `eri-coreutils` Rust binary.
3. Bundle script copies `eri-coreutils` into `eri.app/Contents/Resources/bin/`.
4. The bundled VSCode extension `eri.voice-and-diffusion` spawns it on activation.
5. Code-sign + notarize → ship.

## Reskin layer (the patches in `patches/eri/`)

These patches stack on top of VSCodium's de-MS patches and produce the Cursor-aesthetic:

| Patch | What |
|---|---|
| `eri-01-product-json.patch` | `nameLong = "eri"`, app icon, URL scheme, identifiers |
| `eri-02-default-theme.patch` | Dark theme with `#0A0A0A` bg / `#F5F2EC` text / `#E0FF4F` accent baked as the default |
| `eri-03-activity-bar.patch` | Custom monogram top-of-activity-bar; AI panel pinned second slot |
| `eri-04-ai-panel.patch` | Bake the eri AI panel as a first-class workbench part (right side, resizable) |
| `eri-05-cmdk-overlay.patch` | Cursor-style floating Cmd-K inline-edit overlay |
| `eri-06-welcome.patch` | Replace VSCode welcome with eri onboarding (sign-in + license tier reveal) |
| `eri-07-marketplace-openvsx.patch` | (already done by VSCodium, just verify) |
| `eri-08-statusbar-mic.patch` | Mic indicator + diffusion-fire pulse in the status bar |

Each patch lands as a separate file so they can be re-applied when we pull upstream `microsoft/vscode` updates.

## The bundled extension (`eri.voice-and-diffusion`)

A normal VSCode extension that ships *inside* the IDE (compiled-in, not user-installable). Responsibilities:

- Spawn the `eri-coreutils` sidecar at startup, attach to stdio.
- Render the AI panel React/Preact tree.
- Wire `cmd-k` to the inline edit overlay.
- Stream Mercury 2 deltas into a webview-backed preview pane.
- Handle the voice mic UI (push-to-talk + hot-mic).
- Handle billing-tier gating (call `eri_billing` over RPC, hide gated features).

## What we lose

- **Native-Rust speed.** Electron is the floor now. We don't market "fast" any more — we market "the AI experience Cursor wishes it had" + voice-first.
- **GPUI investment.** ~5kLoC of `eri_app` / `eri_ui` work goes to trash. The `eri_*` business logic survives.
- **Bundle size.** Electron + VSCode + our extension + Rust sidecar ≈ ~250MB. Acceptable for an IDE.

## What we keep

- All inference, voice, iterator, diffusion pipeline work. Untouched.
- The website / billing / Supabase / Stripe stack. Untouched.
- The brand. Untouched.

## Sequencing

1. **Now.** Clone VSCodium ✅. Research the Cursor reskin punch-list (agent running).
2. **Next session.** Scaffold `crates/eri_coreutils` as the sidecar binary. Wire up JSON-RPC.
3. **Then.** Author `patches/eri/eri-01-product-json.patch` — first build of branded eri.app.
4. **Then.** Author the AI panel extension. Wire stdio sidecar. End-to-end voice → diffusion test.
5. **Then.** Apply theme patches (`eri-02` through `eri-08`). Side-by-side visual diff vs Cursor.
6. **Then.** Delete `crates/zed`, `crates/eri_app`, `crates/eri_ui`. Cleanup.
7. **Then.** Code-sign, notarize, ship to website.
