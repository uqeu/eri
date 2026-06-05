# Releasing the eri_agent SDK + bindings

The Rust core is `crates/eri_agent`. The language bindings are
`crates/eri_agent_py` (Python, PyO3) and `crates/eri_agent_node` (Node, napi).
Both are **excluded** from the Cargo workspace (a Python/Node extension cdylib
needs special linker flags) and are built from their own directories.

## CI gate (every push to `main` + PRs)

`.github/workflows/ci.yml` runs:

- `cargo fmt -p eri_agent -p eri_cli --check`
- `cargo clippy -p eri_agent -p eri_cli --no-deps -- -D warnings`
- `cargo test --workspace`  (the full ~846-test suite)
- build + test the **Python** wheel (install from the wheel, run `pytest`)
- build + test the **Node** addon (run the package smoke test)

A release should only be cut from a green `main`.

## Cutting a release

Publishing is automated by `.github/workflows/release-sdk.yml`, triggered by a
tag:

```bash
git tag sdk-v0.1.0
git push origin sdk-v0.1.0
```

That workflow:

1. builds Python wheels on Linux / macOS / Windows (maturin) + an sdist,
2. builds the Node native addon on all three,
3. **publishes** to PyPI and npm — but only if the repo has the secrets set
   (otherwise it just builds + uploads artifacts, so the tag still validates).

### Required repo secrets

| Secret | Used for |
|---|---|
| `PYPI_API_TOKEN` | `maturin upload` to PyPI |
| `NPM_TOKEN` | `npm publish` to the npm registry |

Set them under **Settings → Secrets and variables → Actions**. Publishing is a
deliberate, credentialed step: without the tokens the pipeline is a safe
build-and-validate.

## Manual release (no CI)

```bash
# Python
cd crates/eri_agent_py && maturin publish      # needs MATURIN_PYPI_TOKEN

# Node
cd crates/eri_agent_node && npm run build && npm publish   # needs npm auth
```
