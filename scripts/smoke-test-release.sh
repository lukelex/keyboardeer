#!/usr/bin/env bash
# Run the Linux release build and package install smoke test in Ubuntu 24.04.
# This validates packaging without modifying the host system.
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
image="keyboardeer-release-smoke:local"

if ! command -v docker >/dev/null 2>&1; then
  printf 'Docker is required for the release smoke test.\n' >&2
  exit 1
fi

docker build --tag "$image" --file "$repo_root/packaging/ubuntu-release-smoke.Dockerfile" "$repo_root"
printf 'Ubuntu release smoke test passed.\n'
