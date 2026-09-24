#!/usr/bin/env bash
# Per-user KeyboarDeer installation and *.kbdprofile.json file association.
#
# Installs the current user's copy of KeyboarDeer and registers it as the OS
# default application for KeyboarDeer profile files, so double-clicking a
# .kbdprofile.json opens it in the app. Registration is per-user and needs no
# root. System package installs handle this in their own post-install scripts.
#
# Usage: scripts/install.sh [path-to-keyboardeer-binary]
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

binary="${1:-}"
if [[ -z "$binary" ]]; then
  for candidate in "$repo_root/build/bin/keyboardeer" "$repo_root/build/bin/keyboardeer-dev-linux-amd64"; do
    if [[ -x "$candidate" ]]; then
      binary="$candidate"
      break
    fi
  done
fi
if [[ -z "$binary" || ! -x "$binary" ]]; then
  printf 'KeyboarDeer binary not found. Build it first (wails build) or pass its path.\n' >&2
  exit 1
fi

data_dir="${XDG_DATA_HOME:-$HOME/.local/share}"
config_dir="${XDG_CONFIG_HOME:-$HOME/.config}"
bin_dir="${HOME}/.local/bin"
applications_dir="$data_dir/applications"
mime_packages_dir="$data_dir/mime/packages"
icon_dir="$data_dir/icons/hicolor/512x512/apps"
icon_source="$repo_root/build/appicon.png"

# xdg-mime default writes $XDG_CONFIG_HOME/mimeapps.list but does not create
# the directory, so a fresh profile needs it up front.
mkdir -p "$bin_dir" "$config_dir" "$applications_dir" "$mime_packages_dir" "$icon_dir"

install -m755 "$binary" "$bin_dir/keyboardeer"
install -m644 "$repo_root/build/linux/keyboardeer-kbdprofile.xml" "$mime_packages_dir/keyboardeer-kbdprofile.xml"
install -m644 "$icon_source" "$icon_dir/keyboardeer.png"
sed "s|%BINARY%|\"$bin_dir/keyboardeer\"|g" "$repo_root/build/linux/keyboardeer.desktop" \
  > "$applications_dir/keyboardeer.desktop"
chmod 644 "$applications_dir/keyboardeer.desktop"

# Refreshing the databases and the default handler is best-effort: headless
# systems may lack a desktop database tool, but the files are still installed.
if command -v update-mime-database >/dev/null 2>&1; then
  update-mime-database "$data_dir/mime" || true
fi
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$applications_dir" || true
fi
if command -v xdg-mime >/dev/null 2>&1; then
  xdg-mime default keyboardeer.desktop application/x-keyboardeer-profile || true
fi

printf 'KeyboarDeer installed at %s/keyboardeer.\n' "$bin_dir"
printf 'Registered keyboardeer.desktop as the default application for *.kbdprofile.json.\n'