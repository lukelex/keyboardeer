# Development setup

## Pinned toolchain

- Go **1.25.x** (the module requires Go 1.25.0)
- Wails **v2.16.0**
- Node.js **22.12+** and npm **10+**
- Linux desktop development dependencies required by Wails (WebKitGTK, GTK3,
  and build tooling); follow the [Wails Linux prerequisites](https://wails.io/docs/gettingstarted/installation/#linux).
- On Arch Linux: `sudo pacman -S --needed gtk3 webkit2gtk-4.1`. The launcher
  detects the 4.1 ABI and selects Wails' matching build tag automatically.

The lockfile is authoritative for frontend dependencies. Do not substitute
manager CLI output, files, or input-device access for the versioned API.

## Commands

From the repository root:

```sh
cd frontend && npm ci
npm run check
npm run lint
npm run build
cd ..
go test ./...
go vet ./...
wails dev
```

`wails dev` needs the Wails CLI at v2.16.0. The browser Vite server is useful
for visual development, but it intentionally shows a binding-unavailable note.
It is not fixture mode and must never be confused with a manager connection.

## Implementation boundary

The desktop app is a client of `kmonad-device-manager`. It never opens input
devices, launches KMonad, or reads manager-private status files. Controls whose
manager capability has not been implemented are disabled and explain why.

## Current desktop behavior

The Wails app connects to the same-user manager API, negotiates the available
capabilities, and enables the corresponding device, editor, validation, profile,
and lifecycle workflows. The Linux release targets KMonad Device Manager
v1.2.0 or later. If the manager is missing or does not advertise a required
capability, KeyboarDeer explains the unavailable state and gates the affected
actions. It does not substitute preview fixtures for live manager data. The
browser Vite preview has no Wails bindings and therefore cannot connect to the
manager.

The window uses the committed app icon where supported and restores its previous
size and position from the per-user KeyboarDeer configuration directory. The
window close button quits the editor; it does not stop the independent manager
or mappings already supervised by it. There is no tray icon in v1: background
runtime control belongs to the manager, and the editor has no hide-to-tray
workflow that requires an always-resident GUI.

## Launch the desktop app

From the repository root, run:

```sh
./scripts/desktop.sh
```

The launcher uses the pinned Wails v2.16.0 CLI through Go, so no global Wails
installation is needed. On its first run Wails installs the locked frontend
dependencies and then starts the desktop app. Pass Wails development arguments
through the script, for example `./scripts/desktop.sh -debug`.

## Install and the `*.kbdprofile.json` file association

KeyboarDeer registers itself as the default application for KeyboarDeer profile
files **during installation**, not from inside the running app. See
`build/linux/keyboardeer-kbdprofile.xml` for the MIME definition and
`build/linux/keyboardeer.desktop` for the handler entry (`%f`); the installed
binary must handle a launch argument ending in `.kbdprofile.json`, which
`main.go` routes to the pending import flow consumed by the editor.

### Per-user install (no root)

`scripts/install.sh` copies a built binary to `~/.local/bin`, installs the
desktop entry, MIME XML, and icon under `~/.local/share`, refreshes the MIME and
desktop databases, and sets `keyboardeer.desktop` as the default handler via
`xdg-mime default`. `scripts/uninstall.sh` reverses all of it.

```sh
wails build
./scripts/install.sh            # or pass the binary path explicitly
```

### Debian package

`scripts/package-deb.sh` builds `build/keyboardeer_<version>_<arch>.deb` from a
built binary (`dpkg-deb` required, run in CI or on a Debian machine). The
package installs the binary to `/usr/bin`, and its `postinst` runs
`update-mime-database`, `update-desktop-database`, and writes the default
association into `/usr/share/applications/mimeapps.list`; `prerm` reverses the
registration on removal.

```sh
wails build
BINARY=build/bin/keyboardeer VERSION=1.0.0 scripts/package-deb.sh
```

## CI release artifacts

The `Linux release` workflow runs on Ubuntu 24.04 for manual dispatches and
`v*` tags. It verifies Go and frontend tests, builds the Wails binary with the
pinned v2.16.0 CLI, creates a Debian package and a portable amd64 tarball, and
writes `SHA256SUMS`. Tagged runs publish the artifacts as a GitHub Release;
manual runs retain them as workflow artifacts.

The release package targets Linux amd64 and requires GTK3 and WebKitGTK 4.1 at
runtime, plus a running same-user `kmonad-device-manager` v1.2.0 or newer.
Installers register `*.kbdprofile.json` for KeyboarDeer. Updates replace the
binary and registration files in place; uninstall with the package manager or
`scripts/uninstall.sh` for a per-user installation.

The packaging path can also be smoke-tested without modifying the host:

```sh
./scripts/smoke-test-release.sh
```

The Ubuntu 24.04 container builds the artifacts, verifies `SHA256SUMS`, checks
Debian metadata, installs the package, confirms its binary/desktop/MIME files,
and removes it again. It does not replace real-keyboard TEST-04 coverage or
desktop rendering tests.

For a fuller clean-install test on a Linux host with KVM/QEMU installed, use:

```sh
./scripts/kvm-release-acceptance.sh
```

This boots a disposable Ubuntu 24.04 cloud VM, installs the release package,
checks its desktop and MIME registration, repeats the install as an upgrade,
and purges it. The VM is removed after the run and SSH is forwarded only to
localhost. Set `DEB=/path/to/package.deb` to test a specific artifact. USB
passthrough is deliberately not enabled by default; it should be added only
for a controlled physical-keyboard TEST-04 run.
