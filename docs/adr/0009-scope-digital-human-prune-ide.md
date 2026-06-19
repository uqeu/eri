# ADR-0009: scope — eri is a digital human (personal world model); demote Build to a capability, cut the IDE/old eras

- Status: Accepted
- Date: 2026-06-19
- Context: digital-human grill ([[project_eri_digital_human]]). The repo carries several accreted eras (IDE-fork → computer-control → phone → digital human). The directive: no bloat, no old, no deprecated — if it doesn't lead to the digital-human endgame, cut it.

## Decision

1. **The product is the digital human** — a personal world model that lives on your computer and phone: it perceives (Eyes), hears/speaks (Voice), remembers (the world-model graph), controls your computer hands-free (Control), reaches your apps (Connectors), and is alive with its own personality. **Surface = the Overlay companion** (compact pill ↔ expandable panel, the real `overlay.html`) on the computer + **phone (iMessage)**. The Overlay is the *superset* companion: ask-about-screen (Cluely/Pluely-class) + conversational (iMessage-class) + computer-use, and the differentiator is **it controls your computer while you talk to it** ("goodbye mouse and keyboard"). Control is a flagship capability, built SOTA (beat pointer.ai), behind the world model.

2. **Build is demoted from a product/mode to a capability.** eri can build software — but via its **agent + Control + the base engine (Claude codes natively)** and the lean reusable pieces `eri_apply`/`eri_git`, **not by being an IDE.** The morph-pad-into-editor surface is retired.

3. **CUT (old era, not endgame):** `ide/` (VSCodium fork), Mercury (diffusion live-edit), `eri_tab` (inline completion), `eri_slack` + `eri_discord` (→ unified Composio + `eri_mcp` connector layer, ADR-aligned), `eri_codemaps`, `eri_review`, `pluely-master/` (kept only as a feature *reference* to mine, not shipped code).

4. **VERIFY-then-decide (not guessed):** `eri_skills`, `eri_hooks`, `eri_rules`, `eri_iterator`, `eri_agent_py`, `eri_agent_node`, `eri_images` — check whether each is load-bearing for the live runtime (agent-manager / website / cloud) before cutting. **No deletion lands unless the workspace still compiles + tests pass.**

5. **KEEP = the brain + body:** `eri_inference` (memory→world model), `eri_graph` (the brain), `eri_control` + the control loop, `eri_voice`, `eri_router` (RouteLLM), `eri_caveman`, `eri_mcp`/`eri_mcp_server`, `eri_index`, `eri_cache`, `eri_auth`/`eri_tokens`/`eri_billing`, `eri_telemetry`, `eri_settings`, `eri_core`, `training/`, plus lean `eri_apply`/`eri_git`. `eri_cli` (~25k LOC) and `eri_coreutils` (~16k) stay but get **slimmed** to the agent/control/memory path (drop IDE-era services) as a follow-up.

## Consequences

- A materially smaller, endgame-aligned workspace: one surface (Overlay + phone), one connector layer, one brain (the graph), Control as flagship, Build as a capability not a fork.
- Deletions are a build task executed green (compile + tests) crate-by-crate, not a single sweep; the "verify" set is checked for live-runtime usage first.
- `CONTEXT.md` updated: "Morph pad"→"Overlay"; "Build" reframed mode→capability; "eri builder" softened (one audience: the person, with building as one thing eri does).
- ADR-0005 (tiered actuation) stands and is reinforced — Control is flagship. ADRs 0006–0008 (contract, one-graph, confidential-cloud) define the kept core.

### Accepted risks

- **Cutting shipped, tested work** (the eri-code harness, ~hundreds of tests). Mitigation: it's pre-users; the capability (coding) survives via Claude + agent; cuts are reversible from git history if a kept path turns out to need a cut piece. Verify-then-delete-green prevents silent breakage.
