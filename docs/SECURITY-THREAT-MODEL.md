# eri — distribution security & threat model

This documents what shipping eri's binary does and does **not** protect, so the
promises we make are honest. Run `scripts/harden_eri.sh` before packaging.

## The hard truth (set expectations)

**You cannot make a binary that has to run un-inspectable.** The CPU must decrypt
code to execute it, so any local software can ultimately be reverse-engineered by
a determined attacker with enough time. This is why even AAA games and commercial
DRM get cracked. Anyone who promises "fully encrypted, uncrackable" client
software is wrong.

So the goal is **not** "impossible to inspect." It is:

1. **Ship zero secrets** — the only catastrophic outcome. ✅ Achieved by design.
2. **Raise the bar past casual cracking** — no one can just open the app and read
   the source or list the internals. Stops "lol I opened eri and hacked it."
3. **Keep the moat in compiled native code**, not in the one plaintext layer.

## What's protected (and how)

| Asset | Exposure if naive | What we do | Residual risk |
|---|---|---|---|
| **Claude/API keys** | catastrophic | Not in the client at all — all inference goes through the website proxy; the key lives server-side. `harden_eri.sh` step 1 is a build **gate** that aborts if any secret-like string is present. | none (as long as the gate stays green) |
| **The routing brain, prompts, model strategy** (the IP) | source readable | Lives in the **Rust** binaries — compiled machine code, then `strip`ped of local symbols. Not source; structure not trivially listed. | a skilled RE can still disassemble; strings are extractable |
| **WebView frontend** (`manager.js/css/html`) | plaintext — "Show Package Contents" reads it all | Minified + **mangled** (terser `--compress --mangle --toplevel`) and **bundled inside the `.app`** (`Contents/Resources/web/`), not loaded from a loose repo folder. Variable names become meaningless; comments gone. | logic is obfuscated, not encrypted; bridge command names remain (they're a contract, not IP) |
| **Native binaries** | symbols list the structure | `strip -x` removes local symbols (e.g. 1147 → 289). | exported/system symbols remain; disassembly still possible |
| **Code injection / tampering at runtime** | dylib injection | Hardened-runtime **entitlements** emitted (`apps/eri.entitlements`); applied at release via `codesign --options runtime` + notarization. | only effective once signed (deferred until public release) |

## What is deliberately NOT done yet

- **Developer-ID signing + notarization + `.dmg`** — deferred until eri has been
  run privately and proven stable. Required before any public release (Gatekeeper
  blocks unsigned apps on other Macs). The hardened-runtime entitlements above are
  ready for that step.
- **Stronger JS obfuscation** (control-flow flattening, string encryption via
  `javascript-obfuscator`) — terser mangle is the safe default that can't break
  the WebKit bridge; the heavier pass is an option if the casual-read bar needs
  raising further. It still isn't encryption.

## The honest one-liner for users / marketing

> eri ships compiled, stripped, secret-free, with its frontend obfuscated and
> sealed inside the app — there's nothing to casually read or steal. (We don't
> claim it's uncrackable; no local software can be.)

## Run it

```bash
scripts/harden_eri.sh            # harden the existing .app in place
scripts/harden_eri.sh --build    # rebuild the app first, then harden
```
The script is idempotent and gates on secrets — wire it into the release pipeline
right before signing.
