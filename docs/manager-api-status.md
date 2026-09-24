# KeyboarDeer ↔ Manager API compatibility matrix

**Source review:** 2026-09-23 at upstream `main` commit
[`aa3e88c8d371906030969f32b51c4ed376710d88`](https://github.com/lukelex/kmonad-device-manager/commit/aa3e88c8d371906030969f32b51c4ed376710d88).

**Development smoke test:** On 2026-09-23, KeyboarDeer built that exact source
in an isolated worktree and exercised `session.hello`, `manager.get`,
`snapshot.get`, `device.list`, and `validation.preview` over its real Unix
socket. The manager reported healthy Linux/evdev capabilities and a coherent
two-device snapshot. An otherwise-valid behavior model reached KMonad but was
rejected because the manager-rendered `defcfg` lacked an output form (see the
source-contract gap below); no configuration was applied or device mapping
changed.

**Deployed-manager recheck:** The running user service first reached
`ab37fad81b7aa1615ce3fd26d7810e957757a696` (a descendant of `aa3e88c`), where
the missing-output preview failure remained. It was then updated to
`41b32c733a2fc3081713cf8791610fa5cd833dfa`: the exact renderer now owns both
input and output forms, and a real behavior-only preview returned
`validation.valid` from KMonad dry-run.

**Device-role contract:** Unreleased manager worktree based on commit
[`14eec6b63bbf`](https://github.com/lukelex/kmonad-device-manager/commit/14eec6b63bbf)
adds `Device.role` to `snapshot.get` and `device.list`. Supported values are `input` and
`manager_output`. A `manager_output` is a manager-created KMonad uinput-sink
device and must not be shown, identified, previewed, configured, or have
bindings enabled/disabled by KeyboarDeer. KeyboarDeer treats a missing role as
`input` for compatibility with older managers, and uses no device-name
heuristic.

This is KeyboarDeer's maintained list of manager interactions. It is a source
compatibility audit, **not** a statement about released manager binaries or a
substitute for an integration smoke test. Re-audit this matrix whenever the
pinned manager commit changes.

**Evidence priority:** the pinned source dispatcher and domain types win over
wiki prose. The [current wiki](https://github.com/lukelex/kmonad-device-manager/blob/aa3e88c8d371906030969f32b51c4ed376710d88/wiki/Manager-API-v1.md)
contains both an obsolete opening status sentence and forward-looking API prose;
it is valuable contract context but does not prove a handler exists.

Relevant source:

- [`api_transport.go`](https://github.com/lukelex/kmonad-device-manager/blob/aa3e88c8d371906030969f32b51c4ed376710d88/internal/manager/api_transport.go)
  — request dispatcher and event framing;
- [`domain.go`](https://github.com/lukelex/kmonad-device-manager/blob/aa3e88c8d371906030969f32b51c4ed376710d88/internal/manager/domain.go)
  — public objects, operations, snapshot, and events;
- [`snapshot.go`](https://github.com/lukelex/kmonad-device-manager/blob/aa3e88c8d371906030969f32b51c4ed376710d88/internal/manager/snapshot.go),
  [`apply.go`](https://github.com/lukelex/kmonad-device-manager/blob/aa3e88c8d371906030969f32b51c4ed376710d88/internal/manager/apply.go), and
  [`events.go`](https://github.com/lukelex/kmonad-device-manager/blob/aa3e88c8d371906030969f32b51c4ed376710d88/internal/manager/events.go)
  — source evidence for the newer functionality.

## Method inventory

| Manager interaction | Source status at `aa3e88c` | KeyboarDeer client status | Product use / limitation |
| --- | --- | --- | --- |
| `session.hello` | Implemented. Required first request; returns server ID, manager version, and initial state revision. | Implemented. | Start every connection; a changed server ID invalidates cached snapshot/event state. |
| `manager.get` | Implemented by `aa3e88c`; returns public manager metadata, limits, health, event cursor, and the complete capability list. | Implemented; current bridge consumes capabilities and safely ignores newly added fields. | Normal capability-aware startup is source-ready and was smoke-tested against a manager built from this commit. |
| `snapshot.get` | Implemented by `bf34fa0`; returns coherent devices, configurations, retained operations, manager health, state revision, and event cursor. Desired/active configuration state arrived in `60f49a5`. | Implemented for the normal workspace bridge. | The Devices view now uses the authoritative snapshot, proven against the isolated source build. Snapshot currently has health, not a separate diagnostics collection. |
| `device.list` | Implemented. Refreshes and returns known keyboard-capable devices. | Implemented. | Normal device inventory is now enabled only when the runtime capability advertises `device_discovery`; smoke-test it against a source build. |
| `configuration.list` | Implemented by `a0adbd7`; returns managed and external configuration resources without paths/content. | Not yet implemented. | Read-only external and managed configuration inventory. It cannot display raw `.kbd` text. |
| `device.identify.start` | Implemented. One bounded 1–30-second session for a connected device. | Implemented. | Normal UI is capability-gated; harness can exercise it. |
| `device.identify.cancel` | Implemented. | Implemented. | Only while the matching identification operation is live. |
| `operation.get` | Implemented over the retained operation store, despite the historical helper name. | Implemented. | Can read identify and retained apply/lifecycle operations. Polling is useful before events are integrated. |
| `validation.preview` | Implemented. Model preview is side-effect-free; returns valid, rejected, or blocked. | Implemented and smoke-tested successfully against deployed `41b32c7`. | Use `{model:{device_id,behavior}}`; GUI profiles never supply `defcfg` or `device-file`. |
| `configuration.apply` | Implemented by `2516765`; transactional render, validation, persistence, activation confirmation, and rollback pipeline. | Not used directly. | KeyboarDeer uses the explicit create/update routes so a local profile retains one opaque managed-configuration ID. |
| `configuration.create` / `configuration.update` | Implemented. Create accepts name/model; update requires configuration ID and expected revision. | Implemented. | The Apply control sends a current validated draft directly; updates read the current authoritative desired revision and submit it as `expected_revision`. |
| `configuration.set_enabled` / `configuration.delete` | Implemented by `f8ea0ec`. Both require expected revision. | Implemented, using the snapshot's desired revision. | Keyboard cards expose a checked/unchecked binding state and a confirmed "Remove from keyboard" action that keeps local profiles. External configurations remain read-only. |
| `configuration.adopt` | Implemented by `bff4dd2` for manager-validated, losslessly representable external configurations. | Not yet implemented. | Later, opt-in adoption only. Arbitrary visual import remains outside v1. |
| `events.subscribe` | Implemented by `4551637`; resumable cursor support arrived in `9d44f1f`. Reply is followed by ordered `event` frames on the same connection; resync requires a fresh snapshot. | Dedicated persistent subscription transport and snapshot-coalescing workspace monitor are implemented. Cursors persist in app-owned state; gaps, server changes, resync, and future event types are covered by socket fixtures. | A manager built from the pinned source remains required for an end-to-end desktop smoke test. |

## Interaction-to-screen cross-reference

This is the application-facing checklist. A **source-ready** interaction may
still be unavailable in the shipped GUI because the KeyboarDeer client, profile
model, or a required runtime capability is unavailable.

| KeyboarDeer interaction | Manager calls | Source-ready? | App-ready? | What still blocks it |
| --- | --- | ---: | ---: | --- |
| Connect and establish trust | `session.hello` → `manager.get` | Yes | Partial | Run an integration smoke test against a manager built from this commit; expand the client to retain public limits, health, and event cursor. |
| Devices landing page | `snapshot.get` | Yes | Partial | Current app uses the authoritative snapshot; event synchronization and richer state presentation remain. |
| Runtime health, desired/active revisions, conflicts | `snapshot.get` | Yes | Partial | Devices show associated configuration phase and desired/active revisions; add dedicated diagnostics and event-driven refresh. Do not derive health from names or CLI output. |
| Identify a keyboard | `device.identify.start`, `operation.get`, `device.identify.cancel` | Yes | Partial | Current UI is capability-gated; smoke test it against a source build. |
| Create and reopen an editor draft | None; application-owned persistence | N/A | Partial | The UI explicitly selects a verified US ANSI 60%, US ANSI TKL, or split Kinesis Freestyle 2 geometry, creates/reopens a local draft, and persists Base-layer key assignments. Repeated physical source codes in the Freestyle layout share a binding. Multiple-profile management, layers, undo/redo, and more behaviors remain. |
| Compile behavior and live preview | `validation.preview` | Yes | Partial | The editor compiles and previews its complete saved draft after a Base-layer edit, coalescing rapid edits for 250 ms and discarding mismatched draft revisions. Successful behavior-only preview is proven on deployed `41b32c7`; add bounded preview concurrency, diagnostics adapter, and broader editor UI. |
| Receive device/runtime changes | `snapshot.get`, `events.subscribe` | Yes | Partial | The app performs a snapshot-to-subscription handoff, persists replay cursors, and resyncs after stream loss, gaps, or manager restart. An end-to-end desktop smoke test against the deployed manager remains useful. |
| Apply a managed profile | `configuration.create` / `update`, then snapshot/events | Mostly | Partial | The editor requires a current valid preview, connected device, and manager capability. Create/update performs manager-owned validation and activation. The request and its idempotency key are persisted before dispatch; an unconfirmed apply is replayed with the same key, and `stale_revision` triggers refresh-and-review. |
| Enable or disable managed runtime config | `configuration.set_enabled` / `configuration.delete` | Yes | Partial | Keyboard cards use a fresh snapshot revision and direct checkbox state. Removal is a separate, confirmed action; it clears only the removed configuration's profile link. |
| Show external runtime configuration | `snapshot.get` / `configuration.list` | Yes | Partial | Snapshot-backed device cards expose associated configuration state; a dedicated read-only external screen remains. |
| Show external raw `.kbd` source | No supported API | **No** | No | A manager-owned, access-controlled content-read/export API. Do not read manager files directly. |
| Adopt an external config | `configuration.adopt` | Yes | No | External inventory UI, clear lossless-representability explanation, and managed-profile hand-off UX. |

## Source-contract gaps that still matter

### 1. Capability negotiation is now source-ready

Commit `aa3e88c` implements `manager.get` and reports public manager metadata,
health, limits, an event cursor, and every capability. KeyboarDeer can now use
its normal capability-gated Devices and Identify flow against a manager built
from this source. It must still negotiate at runtime and treat unavailable
capabilities as disabled; this source audit is not a released-binary guarantee.

### 2. Durable idempotency — implemented in manager `v1.1.0`

Manager `v1.1.0` (`712f4aa`) requires a 1–128-byte `idempotency_key` on
`configuration.create`, `update`, `apply`, `set_enabled`, `delete`, and
`adopt`, binds it durably to a fingerprint of the method and parameters, and
replays the original operation (running or finished) for the same key and
parameters, including after a manager restart. Reusing a key with different
parameters fails with `idempotency_conflict`.

KeyboarDeer sends a fresh key with every mutation. For Apply it persists the
key and the exact request before sending, automatically replays an
unconfirmed request a bounded number of times, and otherwise keeps it for an
explicit, safe "Check apply outcome" replay. Older managers ignore the field.

### 3. External content/export remains unavailable

`configuration.list` provides opaque resource/runtime metadata and
`configuration.adopt` can perform a safe manager-side hand-off. Neither exposes
raw external content or a generated-config export. The External screen may show
runtime inventory; its raw-source panel must stay disabled.

### 4. Diagnostics are resource-oriented, not editor locations

Validation diagnostics include severity, reason, remediation, and an optional
resource. They do not promise a physical source key or behavior span. The
per-key recovery design still needs KeyboarDeer's local compiler/source map and
must leave unmappable manager errors at keymap level.

### 5. Model rendering gap fixed in deployed `41b32c7`

The smoke test sent a standard `(defsrc …)/(deflayer …)` behavior model for a
connected device. `validation.preview` reached KMonad, which rejected the
manager-generated candidate with `Missing setting in 'defcfg': output`. At this
revision `renderManagedConfiguration` emits only the manager-owned input form.
This exposed a model-contract gap: the GUI must not choose a device-specific
`defcfg` representation, but the manager must render a complete runnable one.
Commit `41b32c7` fixes that renderer through a platform-owned complete `defcfg`
and rejects behavior that attempts to provide manager-owned input/output forms.
The updated deployed service accepted the same behavior-only candidate with
`validation.valid`. This removes the preview blocker, but does not change the
separate idempotency and managed-lifecycle gates for Apply.

## Required API behavior

- Use only the same-user Unix socket:
  `$XDG_RUNTIME_DIR/kmonad-device-manager/api.sock`, falling back to
  `~/.config/kmonad-device-manager/api.sock`.
- Use newline-delimited UTF-8 JSON; cap frames at 1 MiB, at most 32 in-flight
  requests, and positive deadlines no greater than 30 seconds.
- Treat manager IDs, revisions, operation IDs, server IDs, reason codes, and
  unknown enum values as opaque/versioned data. Display unknown values safely.
- A new server ID, connection loss, event cursor rejection, or
  `manager.resync_required` invalidates incrementally maintained state: fetch a
  fresh snapshot before subscribing again.
- Closing KeyboarDeer never stops a mapping or cancels an accepted apply.
- Never use CLI output, logs, `status.json`, manager-owned configuration files,
  `/dev/input`, or process IDs as a GUI transport fallback.

## Commit-history progression

The following source commits materially changed KeyboarDeer's integration
ceiling after the earlier `533a7d7` audit:

1. `2516765` transactional managed apply;
2. `c9c63d2` activation rollback;
3. `f8ea0ec` managed lifecycle;
4. `a0adbd7` external inventory and `bff4dd2` external adoption;
5. `60f49a5` desired/active configuration state;
6. `bf34fa0` authoritative snapshots;
7. `4551637` ordered events and `9d44f1f` resumable event cursors;
8. `aa3e88c` public `manager.get` metadata/capability endpoint.

Track KeyboarDeer's executable work in [TODO.md](../TODO.md) and the delivery
sequence in [gui-integration-roadmap.md](gui-integration-roadmap.md).
