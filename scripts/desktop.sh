#!/usr/bin/env bash
# Launch KeyboarDeer in Wails development mode from any working directory.
# The Wails CLI version is pinned here so a global installation is optional.
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

for tool in go node npm; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    printf 'KeyboarDeer needs %s; see docs/development.md.\n' "$tool" >&2
    exit 1
  fi
done

printf 'Starting KeyboarDeer desktop development app…\n'
exec go run github.com/wailsapp/wails/v2/cmd/wails@v2.16.0 dev "$@"
