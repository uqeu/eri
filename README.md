# eri

> Voice-driven, diffusion-native code editor. You speak, you look, eri builds.

## Repo layout

```
.
├── ide/                          Native desktop app — VSCodium fork
│   ├── vscode/                     microsoft/vscode source at the pinned tag
│   ├── patches/eri/                eri reskin patches applied on top
│   ├── extensions/eri-ai-panel/    bundled TS extension (panel, preview, gaze,
│   │                                 composer, tab completions, mentions, MCP)
│   └── build.sh, prepare_vscode.sh, get_repo.sh, …
├── crates/                       Rust sidecar — 22 crates the IDE talks to over JSON-RPC
│   ├── eri_coreutils               binary entrypoint, stdio JSON-RPC server
│   ├── eri_core, eri_inference, eri_iterator, eri_control, eri_router
│   ├── eri_voice, eri_tokens, eri_cache, eri_index, eri_telemetry
│   ├── eri_auth, eri_billing, eri_settings, eri_mcp
│   ├── eri_git, eri_graph, eri_images, eri_caveman, eri_cli
│   └── eri_discord, eri_slack
├── website/                      Marketing site + dashboard — Next.js 14, Vercel
├── scripts/                      Local sidecars (Python/Swift) + pricing model
└── ERI_*.md                      Strategy / architecture / brand docs
```

## Build

```sh
cargo check --workspace          # Rust sidecar
cd website && npm run typecheck  # Marketing site
cd ide/extensions/eri-ai-panel && npm run compile  # Bundled extension
```

## License

Proprietary. See [LICENSE](LICENSE).
