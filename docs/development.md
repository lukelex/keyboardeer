# Development setup

## Pinned toolchain

- Go **1.24.x** (the module's minimum version)
- Wails **v2.16.0**
- Node.js **22.12+** and npm **10+**
- Linux desktop development dependencies required by Wails (WebKitGTK, GTK3,
  and build tooling); follow the [Wails Linux prerequisites](https://wails.io/docs/gettingstarted/installation/#linux).

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

The Wails shell opens on the real, capability-gated **Keyboards** view. With the
reviewed manager revision, it shows **Manager API incomplete** because
`manager.get` is not available and disables device, setup, and identification
actions. This is intentional: the app does not substitute preview fixtures for
live manager data. The browser Vite preview also keeps controls disabled because
it has no Wails bindings.
