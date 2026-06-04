# eri CLI

`eri` is the terminal-native Eri agent. It can answer questions, plan work,
draft apps, edit the current project, emit reviewable artifacts, and ship from
the same account/session model as the workbench.

## Install

```bash
cargo install --path crates/eri_cli
```

The public installer path is:

```bash
curl -fsSL https://tryeri.ca/install | sh
```

New projects can start with:

```bash
npx eri-wizard
```

## Configuration

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `ERI_API_KEY` | yes | - | Bearer token for Eri Cloud or your local Eri gateway. |
| `ERI_BASE_URL` | no | `https://tryeri.ca` | Override for local gateways, staging, or enterprise hosts. |

A `.env` file in the current directory is auto-loaded.

## Core Commands

### `eri`

Start an interactive terminal agent session.

### `eri ask "<prompt>"`

Ask a one-off question about the current project.

### `eri plan "<intent>"`

Create a reviewable implementation plan. Use artifact output when another tool
needs structured data:

```bash
eri plan --output artifact-json "add usage-based billing"
```

### `eri build "<prompt>"`

Generate a first working HTML draft at `./index.html`.

```bash
eri build "make me a coffee shop site"
```

Add `--deploy` to publish after the file is written:

```bash
eri build "minimal SaaS landing page" --deploy
```

Override the output location with `--output some/path.html`.

### `eri ui "<interface>"`

Generate an Eri GenUI component contract for streamed interface output. This is
the structured UI path: Eri constrains the model to known components before the
artifact becomes app code.

```bash
eri ui "billing dashboard with usage credits" --output artifact-json
```

### `eri iterate "<instruction>"`

Apply a targeted edit to `./index.html`.

```bash
eri iterate "swap the hero photo for an espresso shot"
```

Override the target file with `--file some/path.html`.

### `eri scaffold <slug>`

Write a starter template to `./index.html` without an inference call.

```bash
eri scaffold coffee-shop
eri iterate "use a teal accent color and a serif heading font"
```

### `eri ship`

Deploy the current directory, or ask Eri to run the terminal shipping loop:

```bash
eri ship
eri ship --output artifact-json "review the diff and prepare this branch"
```

Use `--dir some/path` to deploy a different directory.

### `eri agent`

List or switch active personas for the current workspace.

```bash
eri agent list
eri agent set builder
```

### `eri memory`

Store and recall project preferences that should survive across sessions.

```bash
eri memory remember "Use pnpm for frontend packages."
eri memory recall "package manager"
```

### `eri mcp list`

Show the MCP servers configured for the current workspace or user.

```bash
eri mcp list
```

### `eri doctor`

Inspect first-run setup: sign-in, active agent, MCP config, workflow manifest,
and operating rules.

```bash
eri doctor
```

### `eri update check`

Ask the active Eri server for the signed CLI release manifest.

```bash
eri update check
eri update check --channel beta --output json
```

## Output Discipline

- `stdout` carries structured summaries, file paths, deployment URLs, usage
  lines, and artifact JSON.
- `stderr` carries live progress and error messages.
- Exit code is `0` on success and `1` on errors.

## First-Run Contract

`npx eri-wizard` writes:

- `.eri/persona`
- `.eri/workflow.json`
- `.eri/onboarding.json`
- `.eri/install.json`
- `.eri/mcp.json`
- `AGENTS.md`

Those files keep the CLI, Agent Manager, MCP server, preview, review, and
checkpoint workflows pointed at the same Eri loop: plan, edit, preview, review,
checkpoint, ship.
