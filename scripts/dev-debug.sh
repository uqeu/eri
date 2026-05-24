#!/usr/bin/env bash
# Dev wrapper for the IDE build with maximum visibility.
# Captures every command + stdout/stderr to /tmp/eri-build-<timestamp>.log
# and tees to the terminal so we can watch + grep after the fact.
set -uo pipefail

cd "$(dirname "$0")/../ide" || exit 1

TS=$(date +%Y%m%d-%H%M%S)
LOG=/tmp/eri-build-${TS}.log

# Build env. VSCodium reads these from version.sh + build.sh.
export OS_NAME="osx"
export VSCODE_QUALITY="stable"
export VSCODE_ARCH="${VSCODE_ARCH:-arm64}"
export SHOULD_BUILD="yes"
export SHOULD_BUILD_REH="no"
export SHOULD_BUILD_REH_WEB="no"
export CI_BUILD="no"
export VSCODE_LATEST="no"
# DISABLE_UPDATE expects a `.yet` placeholder patch which our repo doesn't ship;
# leave update enabled for the dev build.

# Sidecar runtime env (used after build when the IDE launches).
export RUST_LOG="${RUST_LOG:-debug}"
export RUST_BACKTRACE="${RUST_BACKTRACE:-full}"
export ERI_AUDIT_ENABLED="${ERI_AUDIT_ENABLED:-1}"

# Use shasum if sha1sum is missing (macOS default).
if ! command -v sha1sum >/dev/null 2>&1; then
  alias sha1sum='shasum -a 1'
fi

# VSCode 1.116 requires Node 22+ (see vscode/.nvmrc). Default Node on this
# machine is 20 from the official pkg; homebrew node@22 lives elsewhere.
export PATH="/opt/homebrew/opt/node@22/bin:$HOME/.npm-global/bin:$PATH"

# tsx import flag is applied LATER, only around the build.sh invocation.
# If set globally, every plain `node` / `npm` call would itself try to load
# tsx and crash (npm spawns node internally). Keep this scoped.
TSX_IMPORT="--import tsx/esm"

echo "eri build wrapper" | tee -a "$LOG"
echo "log file: $LOG" | tee -a "$LOG"
echo "started: $(date)" | tee -a "$LOG"
echo "node: $(node --version 2>&1)" | tee -a "$LOG"
echo "npm: $(npm --version 2>&1)" | tee -a "$LOG"
echo "VSCODE_ARCH=$VSCODE_ARCH" | tee -a "$LOG"
echo "===" | tee -a "$LOG"

set -x
bash -x build.sh 2>&1 | tee -a "$LOG"
STATUS=${PIPESTATUS[0]}
set +x

echo "===" | tee -a "$LOG"
echo "exit status: $STATUS" | tee -a "$LOG"
echo "ended: $(date)" | tee -a "$LOG"
exit "$STATUS"
