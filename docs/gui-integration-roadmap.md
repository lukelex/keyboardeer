# GUI Integration Roadmap

**Basis:** `kmonad-device-manager` API v1, reviewed 2026-09-23. See the
[pinned method inventory](manager-api-status.md) for source evidence and the
[completion checklist](../TODO.md) for executable work items.

KeyboarDeer is a client of the manager. It owns the visual keyboard-behavior
profile; the manager owns device identity, platform input translation,
validation, activation, KMonad supervision, runtime state, and diagnostics.
The GUI must not substitute CLI output, `status.json`, logs, device paths, or
process IDs for the versioned manager API.

## Current integration reality

The manager's API v1 contract is defined and its same-user Unix socket plus
`session.hello` are implemented. The endpoint is:

```text
$XDG_RUNTIME_DIR/kmonad-device-manager/api.sock
```

(`~/.config/kmonad-device-manager` is the documented fallback base.)

The source implements `device.list`, `device.identify.start`,
`device.identify.cancel`, identification `operation.get`, and
`validation.preview` in addition to `session.hello`. The wiki's opening status
paragraph is stale; the method inventory records this discrepancy.

`manager.get`, `snapshot.get`, `events.subscribe`, and all configuration
lifecycle/adoption methods still return `unsupported_capability` at the
reviewed revision. CLI output remains an operator interface, not a replacement
transport for the GUI.

Therefore the first end-to-end KeyboarDeer milestone depends on manager work
before it can connect to real state:

1. `manager.get` with the complete capability list;
2. `snapshot.get` with full configuration/runtime state alongside device data.

`device.list` can already support an inventory integration spike.
`events.subscribe` with snapshot/resynchronization recovery follows the first
read-only slice; bounded snapshot refresh is acceptable until it is available.

Preview validation is available now. Applying edits additionally needs safe
managed-configuration lifecycle operations from the manager.

## Integration rules

- Open every connection with `session.hello`, offering API version `1`.
- Use opaque manager IDs verbatim. Do not derive identity from names, serials,
  filenames, paths, or PIDs.
- Gate every feature from `manager.get.capabilities`; never infer it from the
  host OS or manager version.
- Build initial state from `snapshot.get`. Events are incremental hints, not
  the authoritative source; resync with a new snapshot after reconnect,
  manager restart, or `manager.resync_required`.
- Render unknown enum values and reason codes generically so future manager
  values do not break the client.
- For managed configurations, send only a manager `device_id` and
  platform-neutral generated behavior. Never generate `defcfg` or
  `device-file` input configuration in the GUI.
- Durable configuration mutations require an idempotency key and, for existing configurations, an
  expected revision. Surface `stale_revision` as a refresh-and-review state,
  not an automatic overwrite. Ephemeral identification is exempt from these
  revision/idempotency requirements.
- Closing, crashing, or losing the GUI connection must never stop mappings or
  cancel an accepted apply.

## Delivery sequence

Current interface scope is the seven-screen keyboard-draft workspace. Profiles
and Review & Apply are parked. **Live validation is part of editing now**, not
dependent on those future screens; see [live validation and recovery](live-validation.md).

### 0. Lock the boundary and shared fixtures

**KeyboarDeer**

- Scaffold the specified Wails + Go + Svelte 5 + TypeScript application.
- Define TypeScript wire/domain types from API v1: response/error envelopes,
  capabilities, devices, configurations, runtime states, diagnostics,
  operations, snapshots, and events.
- Implement a thin Go Unix-socket client bridge. It owns framing, request IDs,
  deadlines, API negotiation, and reconnect behavior; it does not contain
  platform input logic or KMonad process control.
- Add contract-based API fixtures and a mock manager adapter for development and UI
  tests, covering connected, disconnected, inaccessible, conflicting,
  external, running, waiting, failed, and unknown-state cases.

**Manager**

- Complete `manager.get` and `snapshot.get` on API v1 using
  the documented stable schemas and capabilities.
- Add API contract tests for negotiation, authorization, malformed frames,
  capability-unavailable results, and snapshots.

**Exit criterion:** KeyboarDeer can negotiate with a real manager and has an
explicit fixture mode for development. Normal operation shows a clear
manager-unavailable or API-incomplete state; it never silently substitutes
fixtures for live state.

### 1. Read-only Devices screen

**KeyboarDeer**

- Make Devices the landing screen.
- Render `snapshot.get` devices and configurations together: connected and
  unconfigured, configured and healthy, disconnected-but-known,
  inaccessible, unsupported, and conflicting keyboards.
- Explain states from manager `reason_code`, display text, diagnostics, and
  remediation. Do not collapse a disconnected keyboard into a failed mapping.
- Show external configurations as runtime-visible but read-only.
- Provide capability-aware empty states; hide or disable unavailable actions
  with the manager-supplied reason.

**Manager**

- Complete authoritative snapshot state: configurations, diagnostics,
  operations, known-disconnected inventory, desired/active revisions, and
  manager health (`STATE-001`, `STATE-002`, `DIAG-001`, `CAP-001`).

**Exit criterion:** The view accurately represents a manager snapshot without
any shell-out, polling of manager-private files, or hardware access by the GUI.

### 2. Live state and keyboard identification

**KeyboarDeer**

- Implement the agreed snapshot/subscription handoff without missing changes
  between the two requests; update the view for documented event types.
- On disconnect, event backlog, `manager.resync_required`, or a changed
  manager `server_id`, discard incremental state, obtain a fresh snapshot, and
  resubscribe.
- Add the bounded identify flow: start with a 1–30 second timeout, show the
  returned operation state, allow cancellation only when permitted, and make
  the brief pause of the selected mapping clear to the user.

**Manager**

- Implement ordered subscription/replay/resync semantics (`EVENT-001`,
  `EVENT-002`). Identification already has API methods; until events exist,
  poll its `operation.get` with bounded requests while the operation is active.

**Exit criterion:** Plug/unplug, configuration runtime changes, operation
updates, and identification results reach the GUI reliably, while a dropped
event stream safely recovers from a snapshot.

### 3. Keyboard draft editor and continuous validation

**KeyboarDeer**

- Introduce a persisted application-level `KeyboardProfile` model: selected
  device reference, geometry, layers, behaviors, aliases, macros, and profile
  settings. This is the editor source of truth.
- Compile the profile into platform-neutral KMonad behavior only. The generated
  `.kbd` candidate remains an artifact and is never parsed back into the
  profile.
- Schedule `validation.preview` for the complete compiled candidate after each
  semantic key/layer/behavior/geometry edit, restore, undo/redo, and targeted
  revert. Pure selection and browsing reuse the current result.
- Coalesce rapid changes, bound concurrent requests, and tie results to local
  draft revision, device, connection, candidate, and environment generation.
  Immediately remove stale success; discard out-of-date responses.
- Keep **Keymap is valid** subtle. Make rejection prominent with affected-key
  and layer markers, cause/remedy details, and issue-to-key navigation. Show
  blocked/unavailable states distinctly; they do not blame key assignments.
- Retain the last fully validated draft as recovery provenance, but revert only
  the selected invalid assignment in the current draft. Preserve other edits,
  record undo, and revalidate. Do not guess key locations for general errors.
- Maintain compiler source mapping; the current manager diagnostics contract
  does not guarantee key-level locations. Keep unmapped errors at keymap level.

**Manager**

- Use the implemented side-effect-free `validation.preview` model route.
  Verify preview/apply consistency when managed lifecycle methods land.

**Exit criterion:** Every edited candidate is checked automatically without
blocking interaction. Stale results cannot turn the indicator green; individual
invalid assignments can be repaired without losing other edits. Preview cannot
persist a configuration, claim a device, or alter a running mapping. A
disconnected/conflicting device is blocked rather than reported as invalid behavior.

### 4. Safe managed configuration lifecycle (parked)

**KeyboarDeer**

- Implement create, update, enable, disable, and delete for managed
  configurations only.
- Show desired versus active revisions, operation progress, rejected updates,
  rollback outcomes, and runtime health independently.
- Handle idempotent retry and `stale_revision` without silently replacing a
  newer edit.

**Manager**

- Deliver transactional, final-revalidated apply (`CFG-003`), rollback after
  failed activation (`CFG-004`), desired lifecycle methods (`CFG-005`), and
  ownership persistence/protection (`CFG-006`).
- Ensure external `.kbd` files remain supervised and are never modified merely
  because a GUI connected.

**Exit criterion:** A failed apply leaves the known-good configuration running
or reports an explicit rollback failure, and no operation on one keyboard
interrupts another.

### 5. Release hardening

- Jointly test the versioned API and mock fixtures (`TEST-001`).
- Test device lifecycle, changed event nodes, identification, and multi-device
  isolation (`TEST-002`).
- Test preview isolation, revalidation, rollback, GUI crash at each apply
  phase, and external-config protection (`TEST-003`).
- Test reconnect/event ordering/resync against a fresh snapshot (`TEST-004`).
- Keep headless status, doctor, service supervision, hotplug recovery, and
  external configuration workflows working with no GUI (`COMPAT-001`).

## Immediate backlog

| Order | Owner | Work item | Dependency |
| --- | --- | --- | --- |
| 1 | KeyboarDeer | Create Wails scaffold, API v1 types, socket-client seam, and fixtures | API contract and design prototype |
| 2 | Manager | Implement `manager.get` and `snapshot.get` | API transport |
| 3 | KeyboarDeer | Exercise existing device list, identify, operation lookup, and model preview in an integration harness | 1 |
| 4 | KeyboarDeer | Build fixture-backed read-only Devices screen and unavailable-manager state | 1 |
| 5 | KeyboarDeer | Connect Devices screen to manager snapshot/capabilities | 2, 4 |
| 6 | Manager | Implement event stream/resync | EVENT-001/002 |
| 7 | KeyboarDeer | Add live updates and identify UX | 5–6 |
| 8 | KeyboarDeer | Build keyboard drafts, compiler/source map, live whole-draft validation, and per-key recovery | 1, 3; can proceed alongside events |
| 9 | Manager | Implement transactional apply, rollback, and managed storage | CFG-003–006 |
| 10 | KeyboarDeer | Connect managed lifecycle UX and meet release gates (parked) | 8–9 |

## References

- [Manager API v1](https://github.com/lukelex/kmonad-device-manager/wiki/Manager-API-v1)
- [Manager GUI integration plan](https://github.com/lukelex/kmonad-device-manager/wiki/GUI-Integration-Plan)
- [Manager command reference](https://github.com/lukelex/kmonad-device-manager/wiki/Command-Reference)
- [KeyboarDeer project description](project-description.md)
