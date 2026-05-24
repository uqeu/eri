# Crash Handling

The eri sidecar writes three local log files, all under
`<workspace>/.eri/` when a workspace is known, and `~/.eri/` otherwise:

| File          | Owner              | Format | Trigger                          | Opt-in |
|---------------|--------------------|--------|----------------------------------|--------|
| `crash.log`   | `crash.rs`         | JSONL  | `std::panic::set_hook` fires     | No     |
| `sidecar.log` | `crash.rs`         | JSONL  | every `tracing` event            | No     |
| `audit.log`   | `audit.rs`         | JSONL  | every JSON-RPC dispatch          | Yes    |

`crash.log` and `sidecar.log` are **always on** — they are the safety
net the user gets on first launch. `audit.log` is opt-in per the
local-first manifesto.

## What gets logged

Every panic produces one JSON line in `crash.log`:

```json
{
  "at_ms": 1716480000000,
  "kind": "panic",
  "message": "...",
  "thread": "tokio-runtime-worker",
  "location": "<workspace>/crates/eri_inference/src/lib.rs:42:9",
  "backtrace": "..."
}
```

## Sanitization

The crash hook and Sentry `before_send` callback apply the same rules:

1. Strings longer than 200 chars are replaced with `<truncated:N-chars>`.
2. Absolute paths matching the active workspace are rewritten to
   `<workspace>/...`.
3. Sentry events have `extra.params`, `extra.prompt`, `extra.messages`,
   `extra.body`, `extra.secret`, `extra.token`, `extra.key` dropped
   before send.

User prompts, file contents, model outputs, and BYOK secrets are
**never** written to disk or sent to Sentry.

## Sentry opt-in

Sentry is feature-gated at compile time AND opt-in at runtime:

* Build with `--features sentry` to compile the dependency in.
* Set `ERI_SENTRY_DSN=...` to actually report; empty/unset means no-op.
* The IDE's Settings Hub privacy toggle flips this via
  `eri/sentry/enable` / `eri/sentry/disable`. Toggling at runtime
  affects the next sidecar launch — the live process must restart for
  the env var change to take effect on `sentry::init`.

## Attaching lldb

```bash
lldb -p $(pgrep eri-coreutils)
(lldb) bt all
```

## Sidecar JSON-RPC methods

| Method                 | Purpose                                    |
|------------------------|--------------------------------------------|
| `eri/crash/recent`     | Return up to `limit` most-recent crashes   |
| `eri/crash/clear`      | Truncate `crash.log`                       |
| `eri/sentry/status`    | `{ enabled, dsnSet, featureCompiled }`     |
| `eri/sentry/enable`    | Set `ERI_SENTRY_DSN` for child processes   |
| `eri/sentry/disable`   | Unset `ERI_SENTRY_DSN`                     |
