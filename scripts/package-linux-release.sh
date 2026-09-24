#!/usr/bin/env bash
# Build reproducible Linux v1 artifacts.
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
version="${VERSION:-0.1.0}"
version="${version#v}"
dist_dir="${DIST_DIR:-$repo_root/dist}"
export SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-0}"

command -v go >/dev/null 2>&1 || { echo "go is required" >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "npm is required" >&2; exit 1; }
command -v dpkg-deb >/dev/null 2>&1 || { echo "dpkg-deb is required" >&2; exit 1; }

cd "$repo_root"
rm -rf "$dist_dir"
mkdir -p "$dist_dir"

go run github.com/wailsapp/wails/v2/cmd/wails@v2.16.0 build \
  -clean -nopackage -platform linux/amd64 -tags webkit2_41 -trimpath \
  -ldflags "-s -w -buildid="

VERSION="$version" BINARY="$repo_root/build/bin/keyboardeer" \
  scripts/package-deb.sh
mv "$repo_root/build/keyboardeer_${version}_amd64.deb" "$dist_dir/"

tarball="$dist_dir/keyboardeer-${version}-linux-amd64.tar.gz"
tar --sort=name --mtime='UTC 1970-01-01' --owner=0 --group=0 --numeric-owner \
  -czf "$tarball" -C "$repo_root/build/bin" keyboardeer

(cd "$dist_dir" && sha256sum ./* > SHA256SUMS)
printf 'Linux release artifacts written to %s\n' "$dist_dir"
