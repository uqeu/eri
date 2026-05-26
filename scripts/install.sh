#!/usr/bin/env bash
# eri — one-line installer
#
# Usage:
#   curl -fsSL https://tryeri.ca/install | sh
#
# Installs:
#   - the eri desktop bundle (eri.app) into /Applications on macOS
#   - the `eri` CLI binary into /usr/local/bin (or ~/.local/bin without sudo)
#
# Configurable via env:
#   ERI_PREFIX     — install root for CLI (default: /usr/local or $HOME/.local)
#   ERI_VERSION    — pin to a specific release (default: latest)
#   ERI_DRY_RUN    — print what would happen without changing anything

set -euo pipefail

ERI_VERSION="${ERI_VERSION:-latest}"
BASE_URL="${ERI_BASE_URL:-https://tryeri.ca}"
DRY_RUN="${ERI_DRY_RUN:-0}"

c_red()    { printf "\033[31m%s\033[0m" "$1"; }
c_green()  { printf "\033[32m%s\033[0m" "$1"; }
c_yellow() { printf "\033[33m%s\033[0m" "$1"; }
c_cyan()   { printf "\033[36m%s\033[0m" "$1"; }
c_dim()    { printf "\033[2m%s\033[0m"  "$1"; }

say()   { printf "%s %s\n" "$(c_cyan ">>>")" "$*"; }
warn()  { printf "%s %s\n" "$(c_yellow "!!!")" "$*" >&2; }
fail()  { printf "%s %s\n" "$(c_red    "xxx")" "$*" >&2; exit 1; }
done_() { printf "%s %s\n" "$(c_green  "✓✓✓")" "$*"; }

require() {
  command -v "$1" >/dev/null 2>&1 || fail "missing dependency: $1"
}

detect_os() {
  case "$(uname -s)" in
    Darwin*)  echo "macos" ;;
    Linux*)   echo "linux" ;;
    *)        fail "unsupported OS: $(uname -s). eri ships on macOS + Linux at launch." ;;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    arm64|aarch64)  echo "aarch64" ;;
    x86_64|amd64)   echo "x86_64" ;;
    *)              fail "unsupported architecture: $(uname -m)" ;;
  esac
}

pick_prefix() {
  if [ -n "${ERI_PREFIX:-}" ]; then
    echo "$ERI_PREFIX"; return
  fi
  if [ -w "/usr/local/bin" ] 2>/dev/null; then
    echo "/usr/local"
  else
    echo "$HOME/.local"
  fi
}

run() {
  if [ "$DRY_RUN" = "1" ]; then
    printf "  %s %s\n" "$(c_dim "dry-run:")" "$*"
  else
    "$@"
  fi
}

main() {
  say "Welcome to eri — let's wire it up."
  say "  protocol: $(c_dim "https://tryeri.ca/install")"
  say "  version : $ERI_VERSION"

  require curl
  require tar
  require uname

  local os arch prefix bin_dir tmpdir
  os="$(detect_os)"
  arch="$(detect_arch)"
  prefix="$(pick_prefix)"
  bin_dir="$prefix/bin"
  tmpdir="$(mktemp -d -t eri-install-XXXXXXXX)"
  trap 'rm -rf "$tmpdir"' EXIT

  say "  os       : $os ($arch)"
  say "  prefix   : $prefix"

  # ---- CLI -------------------------------------------------------------
  say "Downloading eri CLI…"
  local cli_url cli_archive cli_target
  cli_archive="eri-cli-${os}-${arch}.tar.gz"
  cli_url="${BASE_URL}/dl/${ERI_VERSION}/${cli_archive}"
  cli_target="$tmpdir/$cli_archive"
  run curl -fsSL --proto '=https' --tlsv1.2 -o "$cli_target" "$cli_url" \
    || fail "couldn't download $cli_url. Check your network or pin a different ERI_VERSION."

  say "Extracting CLI…"
  run tar -xzf "$cli_target" -C "$tmpdir"

  say "Installing CLI to $bin_dir/eri"
  run mkdir -p "$bin_dir"
  if [ -f "$tmpdir/eri" ]; then
    run install -m 0755 "$tmpdir/eri" "$bin_dir/eri"
  else
    fail "extracted archive did not contain an 'eri' binary"
  fi

  # ---- Desktop bundle (macOS only) -------------------------------------
  if [ "$os" = "macos" ]; then
    say "Downloading eri.app desktop bundle…"
    local app_url app_target
    app_url="${BASE_URL}/dl/${ERI_VERSION}/eri-${arch}.dmg"
    app_target="$tmpdir/eri.dmg"
    if run curl -fsSL --proto '=https' --tlsv1.2 -o "$app_target" "$app_url"; then
      say "Mounting + copying eri.app to /Applications…"
      run hdiutil attach "$app_target" -nobrowse -quiet -mountpoint "$tmpdir/eri-mount"
      if [ -d "$tmpdir/eri-mount/eri.app" ]; then
        run rm -rf "/Applications/eri.app" 2>/dev/null || true
        run cp -R "$tmpdir/eri-mount/eri.app" "/Applications/eri.app"
      else
        warn "DMG did not contain eri.app; skipping desktop install."
      fi
      run hdiutil detach "$tmpdir/eri-mount" -quiet || true
    else
      warn "Couldn't fetch the desktop bundle — CLI is installed and ready."
    fi
  fi

  # ---- PATH hint -------------------------------------------------------
  case ":$PATH:" in
    *":$bin_dir:"*) ;;
    *)
      warn "Your PATH doesn't include $bin_dir."
      warn "Add: $(c_cyan "export PATH=\"$bin_dir:\$PATH\"") to your shell rc."
      ;;
  esac

  # ---- Sign-in ---------------------------------------------------------
  done_ "Installed eri."
  say "Sign in once so the CLI can call your account:"
  printf "    %s\n" "$(c_cyan "eri auth login")"
  say "Or if you already have a token:"
  printf "    %s\n" "$(c_cyan "export ERI_API_KEY=eri_sk_...")"

  if [ "$os" = "macos" ] && [ -d "/Applications/eri.app" ]; then
    say "Desktop ready: $(c_cyan 'open -a eri')"
  fi
}

main "$@"
