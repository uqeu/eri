# eri_cli

A one-shot headless CLI for [eri](../../README.md). Drives the same Mercury 2
backend the IDE uses, but from a terminal — no GUI, no panels, no voice. The
binary is just called `eri`.

Built for:

- Twitter clips and CI demos that need a single deterministic invocation
- Hackers who want `eri build "make me a coffee shop and deploy it"` to work
  from a shell script
- Scripting on top of eri without booting the full editor

## Install

```bash
cargo install --path crates/eri_cli
```

That puts `eri` on your `PATH`. To uninstall: `cargo uninstall eri_cli`.

## Configuration

Set the same environment variables the eri IDE reads:

| Variable                  | Required | Default                                 | Notes                                              |
| ------------------------- | -------- | --------------------------------------- | -------------------------------------------------- |
| `MERCURY_API_KEY`         | yes      | —                                       | Or `INCEPTION_API_KEY`. CLI exits 1 if unset.      |
| `MERCURY_API_BASE`        | no       | `https://api.inceptionlabs.ai/v1`       |                                                    |
| `MERCURY_MODEL`           | no       | `mercury-2`                             |                                                    |
| `MERCURY_EDIT_MODEL`      | no       | `mercury-edit-2`                        | Used for surgical iterations.                       |
| `MERCURY_REASONING_EFFORT`| no       | `medium`                                | One of `instant`, `low`, `medium`, `high`.         |

A `.env` file in the cwd is auto-loaded (same behavior as the IDE).

## Subcommands

### `eri build "<prompt>"`

Streams Mercury 2 with the prompt, writes the resulting HTML to `./index.html`,
and prints token usage + dollar estimate.

```bash
eri build "make me a coffee shop site"
```

Add `--deploy` to publish to Vercel right after the file is written
(`vercel --prod --yes` against the output directory):

```bash
eri build "minimal SaaS landing page" --deploy
```

Override the output location with `--output some/path.html`.

### `eri iterate "<instruction>"`

Applies a surgical edit to `./index.html` via Mercury Edit 2 (the
search/replace tool-call path the IDE uses). Same streaming + cost display as
`build`.

```bash
eri iterate "swap the hero photo for an espresso shot"
```

Override the target file with `--file some/path.html`.

### `eri list-templates`

Prints every template slug + description that ships with eri. These match the
templates the IDE seeds new builds from.

```bash
eri list-templates
```

### `eri scaffold <slug>`

Writes a template's HTML straight to `./index.html` with **no Mercury call**.
Free, instant, deterministic — useful as a starting point you then iterate on.

```bash
eri scaffold portfolio
eri iterate "use a teal accent color and a serif heading font"
```

### `eri ship`

Deploys whatever is at `./index.html` (and the rest of the directory) via
`vercel --prod --yes`, then prints the deployment URL.

```bash
eri ship
```

Use `--dir some/path` to deploy a different directory.

### `eri --version`

Prints the CLI version and Mercury model defaults.

## Output discipline

- **stdout** carries the structured result (file paths, deployment URLs,
  token + cost lines) so you can pipe it into another tool.
- **stderr** carries the live `\r`-updated progress line and any error
  messages. The progress line only animates when stderr is a TTY — in CI
  logs you get a clean single line.
- Exit code is `0` on success, `1` on any error.

## Examples

```bash
# Quick demo
eri build "make me a flappy bird clone" --deploy

# Template + iterate workflow
eri scaffold coffee-shop
eri iterate "darken the hero, change the heading to 'Brew & Co'"
eri ship

# Discover what's possible
eri list-templates
```
