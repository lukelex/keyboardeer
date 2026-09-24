#!/usr/bin/env bash
# Build a Debian package for KeyboarDeer.
#
# The package installs /usr/bin/keyboardeer plus a desktop entry and MIME
# registration for *.kbdprofile.json. The postinst script sets KeyboarDeer as
# the system default application for that MIME type, so double-clicking a
# profile file opens it in the app.
#
# Requires dpkg-deb. Usage:
#   BINARY=/path/to/keyboardeer VERSION=1.0.0 scripts/package-deb.sh
# The default binary is build/bin/keyboardeer.
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
version="${VERSION:-1.0.0}"
arch="${ARCH:-amd64}"
binary="${BINARY:-$repo_root/build/bin/keyboardeer}"

if [[ ! -x "$binary" ]]; then
  printf 'KeyboarDeer binary not found at %s. Build it first (wails build).\n' "$binary" >&2
  exit 1
fi
if ! command -v dpkg-deb >/dev/null 2>&1; then
  printf 'dpkg-deb is required to build the package.\n' >&2
  exit 1
fi

stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
pkgroot="$stage/keyboardeer_${version}_${arch}"

mkdir -p "$pkgroot/DEBIAN" \
  "$pkgroot/usr/bin" \
  "$pkgroot/usr/share/applications" \
  "$pkgroot/usr/share/mime/packages" \
  "$pkgroot/usr/share/icons/hicolor/512x512/apps"

install -m755 "$binary" "$pkgroot/usr/bin/keyboardeer"
sed "s|%BINARY%|\"/usr/bin/keyboardeer\"|g" "$repo_root/build/linux/keyboardeer.desktop" \
  > "$pkgroot/usr/share/applications/keyboardeer.desktop"
install -m644 "$repo_root/build/linux/keyboardeer-kbdprofile.xml" \
  "$pkgroot/usr/share/mime/packages/keyboardeer-kbdprofile.xml"
install -m644 "$repo_root/build/appicon.png" \
  "$pkgroot/usr/share/icons/hicolor/512x512/apps/keyboardeer.png"

install -m644 "$repo_root/build/debian/control" "$pkgroot/DEBIAN/control"
sed -i "s/^Version: .*/Version: $version/" "$pkgroot/DEBIAN/control"
install -m755 "$repo_root/build/debian/postinst" "$pkgroot/DEBIAN/postinst"
install -m755 "$repo_root/build/debian/prerm" "$pkgroot/DEBIAN/prerm"

output="$repo_root/build/keyboardeer_${version}_${arch}.deb"
dpkg-deb --build --root-owner-group "$pkgroot" "$output" >/dev/null
printf 'Package written to %s\n' "$output"
