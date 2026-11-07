#!/usr/bin/env bash
set -euo pipefail
umask 077

# Run the widget against the offline demo helper for a screenshot, then put the
# real helper and cache back. The cache contains spending and credit numbers
# (never the API key), so backups live in a private 0700 directory with 0600
# files and are removed after a successful restore.

repo_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
plugin=crueber.openrouter-usage
live="${XDG_CONFIG_HOME:-$HOME/.config}/omarchy/plugins/$plugin"
cache="${XDG_CACHE_HOME:-$HOME/.cache}/openrouter-usage/usage.json"
demo_helper="$repo_dir/demo/fetch-demo.js"

die() { printf 'demo-session: %s\n' "$*" >&2; exit 1; }
note() { printf '==> %s\n' "$*"; }

command -v omarchy-shell >/dev/null 2>&1 || die "omarchy-shell is required"
[ -f "$demo_helper" ] || die "missing $demo_helper"
[ -f "$live/scripts/fetch.js" ] || die "$plugin is not installed at $live"

work=$(mktemp -d "${TMPDIR:-/tmp}/openrouter-demo.XXXXXX") \
  || die "cannot create a private work directory"
chmod 700 "$work"
backup="$work/backup"
mkdir -m 700 "$backup"

restored=0
backed_up=0

restore() {
  (( restored )) && return 0
  restored=1
  (( backed_up )) || { rm -rf -- "$work"; return 0; }
  note "restoring the real helper and cache"

  local failed=0
  install -m 0755 "$backup/fetch.js" "$live/scripts/fetch.js" || failed=1
  if [ -f "$backup/usage.json" ]; then
    install -d -m 700 "$(dirname -- "$cache")"
    install -m 0600 "$backup/usage.json" "$cache" || failed=1
  else
    rm -f "$cache"
  fi
  case $failed in
    0) rm -rf -- "$work" ;;
    *) printf 'demo-session: restore failed; private backup kept at %s\n' "$backup" >&2 ;;
  esac
  omarchy-shell shell rescanPlugins >/dev/null 2>&1 || true
}

trap restore EXIT INT TERM

# Back up the live helper and the real cache as owner-only files.
install -m 0600 "$live/scripts/fetch.js" "$backup/fetch.js"
if [ -f "$cache" ]; then
  install -m 0600 "$cache" "$backup/usage.json"
fi
backed_up=1

note "installing the offline demo helper"
install -m 0755 "$demo_helper" "$live/scripts/fetch.js"
rm -f "$cache"
omarchy-shell shell rescanPlugins >/dev/null 2>&1 || true
omarchy-shell openrouter-usage refresh >/dev/null 2>&1 || true

cat <<'EOF'
The demo helper is active and the real cache is cleared.

In another terminal:
  omarchy-shell shell toggle crueber.openrouter-usage
  # capture the popup and/or bar
  omarchy-shell shell hide crueber.openrouter-usage

Press Enter here (or Ctrl-C) to restore the real helper and cache.
EOF

read -r _ || true
restore
