#!/usr/bin/env bash
# Health check: spawns the sidecar binary, fires every eri/* JSON-RPC method,
# reports green/red per subsystem. Useful right after first launch.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

BIN="${ERI_SIDECAR:-./target/debug/eri_coreutils}"
if [[ ! -x "$BIN" ]]; then
  echo "sidecar binary not found: $BIN" >&2
  echo "build with: cargo build -p eri_coreutils" >&2
  exit 2
fi

WORKSPACE="${1:-$PWD}"

# Spawn sidecar, talk to it over stdio. Each line is one JSON-RPC request;
# the sidecar replies one line per request.
SIDECAR_LOG=$(mktemp -t eri-sidecar-XXXXXX.log)
echo "sidecar log: $SIDECAR_LOG"

mkfifo /tmp/eri-health-in /tmp/eri-health-out 2>/dev/null || true
trap 'rm -f /tmp/eri-health-in /tmp/eri-health-out; jobs -p | xargs -r kill' EXIT

"$BIN" <"/tmp/eri-health-in" >"/tmp/eri-health-out" 2>"$SIDECAR_LOG" &

# Keep the fifo open for writes.
exec 3>/tmp/eri-health-in
exec 4</tmp/eri-health-out

ID=0
call() {
  local method="$1" params="${2:-{}}"
  ID=$((ID + 1))
  printf '%s\n' "{\"jsonrpc\":\"2.0\",\"id\":$ID,\"method\":\"$method\",\"params\":$params}" >&3
  if IFS= read -r -t 5 reply <&4; then
    if echo "$reply" | grep -q '"error"'; then
      echo "  RED  $method  $(echo "$reply" | jq -c '.error')"
      return 1
    fi
    echo "  ok   $method"
    return 0
  else
    echo "  RED  $method  (no reply in 5s)"
    return 1
  fi
}

echo "=== eri health check ==="
echo "workspace: $WORKSPACE"
echo "===="

pass=0; fail=0
check() { if call "$@"; then pass=$((pass+1)); else fail=$((fail+1)); fi; }

check "eri/ping"
check "eri/version"
check "eri/rules/list" "{\"workspace\":\"$WORKSPACE\"}"
check "eri/index/stats" "{\"workspace\":\"$WORKSPACE\"}"
check "eri/mcp/connect" "{\"workspace\":\"$WORKSPACE\"}"
check "eri/checkpoints/list" "{\"workspace\":\"$WORKSPACE\"}"
check "eri/skills/list" "{\"workspace\":\"$WORKSPACE\"}"
check "eri/codemaps/list" "{\"workspace\":\"$WORKSPACE\"}"
check "eri/graph/stats" "{\"workspace\":\"$WORKSPACE\"}"
check "eri/hooks/list" "{\"workspace\":\"$WORKSPACE\"}"
check "eri/audit/status"
check "eri/tab/health"
check "eri/web/search" '{"query":"hello"}'
check "eri/docs/fetch" '{"name":"react"}'

echo "===="
echo "pass=$pass fail=$fail"
[[ $fail -eq 0 ]]
