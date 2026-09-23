# Manager API integration status

Reviewed **2026-09-23**, against upstream commit
[`533a7d70d768faca6f4b25362a76807cc82b47dd`](https://github.com/lukelex/kmonad-device-manager/commit/533a7d70d768faca6f4b25362a76807cc82b47dd).

Sources:

- [`wiki/Manager-API-v1.md`](https://github.com/lukelex/kmonad-device-manager/blob/533a7d70d768faca6f4b25362a76807cc82b47dd/wiki/Manager-API-v1.md)
- [Published wiki](https://github.com/lukelex/kmonad-device-manager/wiki/Manager-API-v1)
- [`internal/manager/api_transport.go`](https://github.com/lukelex/kmonad-device-manager/blob/533a7d70d768faca6f4b25362a76807cc82b47dd/internal/manager/api_transport.go)

## Important documentation discrepancy

The wiki's opening status paragraph still says only `session.hello` is
implemented. That statement is stale: later sections document identification
and preview, and the API dispatcher handles the six methods listed below.
The previous KeyboarDeer roadmap repeated that opening paragraph; this audit
corrects it. This is a source review, not a smoke test against an installed
manager or a claim that every released binary includes these methods.

## Method-by-method inventory

| Method | Implementation at reviewed revision | KeyboarDeer use |
| --- | --- | --- |
| `session.hello` | Implemented | First request on each connection; negotiate v1, record server ID and version. |
| `manager.get` | Not implemented; `unsupported_capability` | Required for normal capability/health negotiation. |
| `snapshot.get` | Not implemented; `unsupported_capability` | Required for authoritative configuration/runtime state and resynchronization. |
| `device.list` | Implemented; returns `{devices: [...]}` | Inventory, opaque IDs, availability, identity stability, external claim names. |
| `device.identify.start` | Implemented | Start one bounded identification session for a selected device. |
| `device.identify.cancel` | Implemented | Cancel the selected identification operation. |
| `validation.preview` | Implemented | Validate a model or candidate without persisting/applying it. |
| `configuration.create` | Not implemented; `unsupported_capability` | Create a managed profile's runtime configuration. |
| `configuration.update` | Not implemented; `unsupported_capability` | Apply a new candidate revision. |
| `configuration.set_enabled` | Not implemented; `unsupported_capability` | Enable/disable a managed configuration. |
| `configuration.delete` | Not implemented; `unsupported_capability` | Delete a managed configuration and stop it. |
| `configuration.adopt` | Not implemented; `unsupported_capability` | Explicit adoption of representable external configurations; later scope. |
| `operation.get` | Implemented for identification operations only | Poll identification until terminal; do not assume apply/rollback tracking exists. |
| `events.subscribe` | Not implemented; `unsupported_capability` | Future live transitions and replay/resync. |

The capability JSON in the wiki is a contract example, not proof that
`manager.get` is implemented. Runtime capability availability must ultimately
come from the connected manager, not this table or an OS/version heuristic.

## What can start now

- Build and test the Go JSON Lines client and `session.hello` negotiation.
- Exercise real `device.list`, identify, identification polling, and preview in
  an explicit integration/development harness.
- Build the visual Devices screen and editor using clearly labeled fixtures.
- Implement local profiles and the platform-neutral behavior compiler.

For the normal application connection flow, request `manager.get` after hello.
If unavailable, show **Manager API incomplete**, preserve local drafts, and keep
capability-dependent actions unavailable. Do not silently assume capabilities
or use CLI/status-file fallbacks. An explicitly labeled development harness may
exercise the implemented methods to verify integration before that gate lands.

An inventory-only view is possible from `device.list`; it cannot honestly claim
a profile is active or healthy. `configured_by` contains external configuration
names, not the complete managed-profile/runtime model. A complete Devices view
depends on `snapshot.get`. It can use bounded snapshot refresh initially;
event streaming is an incremental milestone, not a prerequisite for a first
read-only slice.

## Request and state details

- Same-user Unix socket:
  `$XDG_RUNTIME_DIR/kmonad-device-manager/api.sock`; absent XDG runtime directory
  falls back to `~/.config/kmonad-device-manager/api.sock`.
- Newline-delimited UTF-8 JSON, 1 MiB maximum frame, at most 32 in-flight requests
  per client, positive `deadline_ms` no greater than 30,000. Bound buffers and
  retry/backoff on the client too.
- Every connection starts with `session.hello` and `supported_versions: [1]`.
  The current implementation returns initial `state_revision: 0`; it is not a
  working snapshot/event consistency mechanism yet.
- Identify start takes `{device_id, timeout_ms?}` (1,000–30,000 ms, 15,000 default).
  Cancel and operation lookup take `{operation_id}`. Identification is ephemeral
  and needs neither an expected configuration revision nor an idempotency key.
- The GUI preview route is
  `{model: {device_id, behavior}}` → `{validation: ValidationResult}`.
  The manager also supports raw `{content: "..."}` for candidate text; GUI-owned
  profiles should use the model route so the manager renders device-specific
  input. Never put `defcfg` or `device-file` into generated `behavior`.
- Preview outcomes are `valid`, `rejected`, or `blocked`. A dry-run timeout is
  blocked, not invalid syntax. Diagnostics carry severity, reason, and
  remediation; retain distinctions between affected resources.
- Future durable mutations require idempotency keys and expected revisions for
  existing configurations. Identification is the explicit exception.
- Event IDs and state revisions are scoped to a manager lifetime. Before live
  events ship, agree a snapshot/subscription handoff that cannot miss changes;
  after gaps, restart, or `manager.resync_required`, rebuild from a snapshot.

## Remaining upstream dependencies

1. Capability/health response and authoritative snapshots, including structured
   diagnostics and separate desired/active/runtime/operation state.
2. Managed storage, create/update/lifecycle methods, revision and idempotency
   enforcement, final revalidation, activation confirmation, and durable rollback.
3. Ordered events, replay cursor semantics, snapshot handoff, and resynchronization.
4. Final stable-identity storage policy and profile-to-configuration association.
5. A documented method for reading raw external configuration if that UI is to
   ship; API v1 currently lists no explicit content-read/export method.
6. Cross-platform backends/transports for the long-term macOS/Windows goal.

Track KeyboarDeer's deliverables and upstream release gates in [TODO.md](../TODO.md).
