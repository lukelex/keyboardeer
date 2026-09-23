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

if pkg-config --exists webkit2gtk-4.1 2>/dev/null; then
  # Arch and other current Linux distributions ship the 4.1 ABI. Wails v2
  # defaults to 4.0, so select the matching build tag when 4.1 is installed.
  set -- -tags webkit2_41 "$@"
elif ! pkg-config --exists webkit2gtk-4.0 2>/dev/null; then
  printf 'KeyboarDeer needs GTK3 and WebKit2GTK development packages.\n' >&2
  printf 'On Arch Linux, install them with: sudo pacman -S --needed gtk3 webkit2gtk-4.1\n' >&2
  exit 1
fi

printf 'Starting KeyboarDeer desktop development app…\n'
exec go run github.com/wailsapp/wails/v2/cmd/wails@v2.16.0 dev "$@"
