#!/usr/bin/env bash
set -euo pipefail

repo_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_dir"

command -v jq >/dev/null 2>&1 || {
  echo "jq is required to validate the manifest" >&2
  exit 1
}

jq -e '
  .schemaVersion == 1
  and (.id | type == "string" and length > 0)
  and (.id == "crueber.openrouter-usage")
  and (.version | type == "string" and test("^[0-9]+\\.[0-9]+\\.[0-9]+$"))
  and (.kinds | type == "array" and index("bar-widget"))
  and (.entryPoints.barWidget | type == "string" and length > 0)
  and (.barWidget.aliases | type == "array" and index("openrouter"))
  and (.barWidget.schema | type == "array")
' manifest.json >/dev/null

entry=$(jq -r '.entryPoints.barWidget' manifest.json)
for file in "$entry" OpenRouterMark.qml Model.js scripts/fetch.js README.md LICENSE; do
  test -f "$file" || {
    echo "missing required file: $file" >&2
    exit 1
  }
done

if command -v omarchy >/dev/null 2>&1; then
  omarchy plugin validate "$repo_dir"
fi

echo "ok"
