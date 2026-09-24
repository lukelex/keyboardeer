#!/usr/bin/env bash
# Remove the per-user KeyboarDeer installation and its file association.
# Reverses scripts/install.sh.
set -euo pipefail

data_dir="${XDG_DATA_HOME:-$HOME/.local/share}"
config_dir="${XDG_CONFIG_HOME:-$HOME/.config}"
applications_dir="$data_dir/applications"
mime_packages_dir="$data_dir/mime/packages"
icon_dir="$data_dir/icons/hicolor/512x512/apps"

rm -f "$HOME/.local/bin/keyboardeer"
rm -f "$applications_dir/keyboardeer.desktop"
rm -f "$mime_packages_dir/keyboardeer-kbdprofile.xml"
rm -f "$icon_dir/keyboardeer.png"

# Best-effort removal of the association from the previous default list, then
# refresh the databases so the freedesktop registries no longer reference it.
if [[ -f "$config_dir/mimeapps.list" ]]; then
  sed -i '/keyboardeer\.desktop/d' "$config_dir/mimeapps.list"
fi
if command -v update-mime-database >/dev/null 2>&1; then
  update-mime-database "$data_dir/mime" || true
fi
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$applications_dir" || true
fi

printf 'KeyboarDeer uninstalled: binary and *.kbdprofile.json association removed.\n'