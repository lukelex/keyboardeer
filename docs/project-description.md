# KeyboarDeer

This document describes the target product. For current implementation status,
see the [API audit](manager-api-status.md), [integration roadmap](gui-integration-roadmap.md),
[interface mockups](design/README.md), and [completion checklist](../TODO.md).

## Project Description

Build a cross-platform desktop application that provides a visual, VIA/Vial-like interface for configuring keyboards through KMonad.

The application should make KMonad usable without requiring users to manually identify input devices, write `.kbd` files, manage KMonad processes, or understand platform-specific input configuration.

The GUI is primarily a **keyboard configuration editor**.

`kmonad-device-manager` is the system-facing runtime responsible for:

- discovering physical keyboards;
- identifying keyboards;
- tracking device availability;
- validating KMonad configurations;
- applying configurations;
- supervising KMonad processes;
- handling reloads and failures;
- reporting runtime state;
- exposing platform capabilities and diagnostics.

The GUI should treat the manager as the authoritative interface to physical devices and the KMonad runtime.

The main product concept is:

> A visual KMonad configurator that provides an experience similar to VIA or Vial, while working with normal keyboards that do not require custom firmware.

---

# Product Goals

The application should allow a user to:

1. See keyboards connected to their computer.
2. Identify which physical keyboard they want to configure.
3. Choose or create a visual representation of that keyboard.
4. Visually assign keys and behaviors.
5. Create multiple layers.
6. Configure more advanced KMonad behaviors without writing KMonad syntax.
7. Validate changes before applying them.
8. Apply changes safely.
9. See whether their configuration is currently active and healthy.
10. Manage multiple keyboards and profiles independently.

The normal workflow should not require opening a terminal or editing a `.kbd` file.

---

# Core Architecture

The application should maintain a clear responsibility boundary.

```text
┌───────────────────────────────────────────┐
│                 GUI App                   │
│                                           │
│  Keyboard selection                       │
│  Visual layout                            │
│  Key mappings                             │
│  Layers                                   │
│  Behaviors                                │
│  Profiles                                 │
│  Config generation                        │
│  Validation/apply UX                      │
└─────────────────────┬─────────────────────┘
                      │
                      │ manager interface
                      ▼
┌───────────────────────────────────────────┐
│          kmonad-device-manager            │
│                                           │
│  Device discovery                         │
│  Device identification                    │
│  Platform integration                     │
│  Validation                               │
│  Apply                                    │
│  KMonad lifecycle                         │
│  Runtime status                           │
│  Diagnostics                              │
└─────────────────────┬─────────────────────┘
                      │
                      ▼
                   KMonad
```

The GUI should not directly:

- inspect `/dev/input`;
- interact with IOKit or Windows input APIs;
- launch or kill KMonad;
- determine whether a KMonad process is healthy;
- implement KMonad crash recovery;
- decide how a physical device should be represented inside `defcfg`.

Those are manager responsibilities.

---

# Technology

## Desktop framework

Use:

**Wails + Go + Svelte 5 + TypeScript**

### Svelte / TypeScript

Responsible for:

- application UI;
- keyboard rendering;
- drag-and-drop key assignment;
- layer editing;
- behavior configuration;
- profiles;
- application state;
- validation and status presentation.

### Go

The desktop backend should remain relatively thin.

It should primarily provide:

- communication with `kmonad-device-manager`;
- local profile persistence;
- config compilation;
- filesystem operations;
- import/export;
- desktop integrations such as tray behavior.

Avoid duplicating functionality already implemented by the manager.

---

# Source of Truth

Configurations created through the GUI should have their own application-level representation.

For example:

```text
KeyboardProfile
│
├── device reference
├── geometry
├── layers
├── key behaviors
├── aliases
├── macros
└── profile settings
```

That model should be the source of truth.

The `.kbd` configuration is a generated artifact:

```text
GUI profile
    ↓
KMonad compiler
    ↓
candidate configuration
    ↓
manager validation
    ↓
manager apply
```

The application should therefore not rely on parsing its own generated `.kbd` files back into application state.

---

# Managed vs External Configurations

Support two concepts.

## Managed configuration

Created by the GUI.

The GUI owns the higher-level model and can visually edit it.

```text
profile
   ↓
generated KMonad config
```

## External configuration

An existing `.kbd` file that was not created by the GUI.

The manager may continue supervising it.

Initially, the GUI only needs to:

- display it;
- show its runtime state;
- expose its raw configuration;
- allow basic management where appropriate.

Full visual importing of arbitrary KMonad configurations is explicitly not required for the first versions.

---

# Main Application Areas

## 1. Devices

The first screen should answer:

> What keyboards are available?

Example:

```text
Keyboards

Keychron Q1
Connected
Default profile active

[Configure]

─────────────────────────────

Logitech MX Keys
Connected
Not configured

[Configure]

─────────────────────────────

Framework Laptop Keyboard
Connected
Not configured

[Configure]
```

Possible states include:

- connected and configured;
- connected and unconfigured;
- disconnected but known;
- configuration failed;
- waiting for device;
- unavailable because of a system problem.

## First delivery target

Deliver the Linux desktop workflow first, using the manager's same-user API.
The stack remains cross-platform, but macOS and Windows support depends on
manager backends and transports, not GUI-owned device access.

Start with a read-only Devices view, then local profiles and visual editing,
manager validation preview, and revision-aware managed apply. Advanced behaviors
and additional layouts follow the same profile/compiler boundary. The visual
prototype illustrates the intended UX; it does not establish backend readiness.
