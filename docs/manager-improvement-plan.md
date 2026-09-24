# Manager improvement plan for KeyboarDeer integration

This is an implementation handover for **`kmonad-device-manager`**. It was
audited against `origin/main` at
`ab8ba4365b5aa7b8024a1ff6c9c721cab0abdea9` (`v1.0.0`), not against uncommitted
work in a developer checkout.

This handover is historical. Manager v1.1.0 (`712f4aa`) has since implemented
the validation digest/location contract, durable idempotency, external content
reads, and managed artifact export. See
[`manager-api-status.md`](manager-api-status.md) for the current compatibility
audit and [`TODO.md`](../TODO.md) for remaining GUI work.

## Goal and ownership boundary

Unblock the remaining KeyboarDeer workflows without giving the GUI device-file
access, KMonad process control, manager-owned file access, or responsibility for
platform `defcfg` rendering.

The manager must continue to own:

- device identity, discovery, availability, and input/output representation;
- rendering, validating, applying, rolling back, and supervising mappings;
- configuration lifecycle and durable mutation outcomes; and
- access-controlled configuration content/export.

The GUI remains responsible for profile storage, visual geometry, editor state,
and translating a reliable submitted-behavior location to its own key/layer
source map.

## Current origin status

Already available in `origin/main`:

- `manager.get`, `snapshot.get`, configurations, retained operations, and
  runtime health;
- bounded identify, model validation, managed create/update, lifecycle
  enable/disable/delete, rollback, and external adoption;
- ordered `events.subscribe`, retained replay, cursor mismatch/backlog resync,
  and slow-subscriber handling.

Still missing or incomplete:

1. Validation responses have neither a candidate digest nor reliable
   submitted-behavior locations.
2. `idempotency_key` is decoded at the transport boundary but is not consumed or
   persisted by mutation handlers.
3. No API exposes raw external content or manager-rendered configuration export.

## Delivery order

1. **MGR-VALIDATION:** reliable validation identity and source locations.
2. **MGR-IDEMPOTENCY:** durable mutation idempotency and operation recovery.
3. **MGR-CONTENT:** access-controlled external content reads and managed export.
4. **MGR-ACCEPTANCE:** integration fixtures, documentation, and release checks.

Each item should be a separately reviewable commit series. Do not merge a wire
field without the durable behavior and tests that make it meaningful.

---

## 1. MGR-VALIDATION — reliable rejected-assignment attribution

### Outcome

For a model preview, a rejected diagnostic may identify a **half-open, 1-based
range in the exact submitted `model.behavior` UTF-8 string**. The response also
identifies that exact candidate by digest. Absence of a location means unknown;
it must never approximate a key.

### Additive wire contract

```json
{
  "outcome": "rejected",
  "candidate_digest": "sha256:…",
  "diagnostics": [{
    "id": "validation.candidate",
    "severity": "error",
    "reason_code": "validation_failed",
    "summary": "…",
    "remediation": "…",
    "location": {
      "scope": "submitted_behavior",
      "start_line": 4,
      "start_column": 12,
      "end_line": 4,
      "end_column": 18
    }
  }]
}
```

Add `candidate_digest` to `ValidationResult` and optional `location` to
`Diagnostic`. The digest is `sha256:` plus SHA-256 of the original
`model.behavior` bytes, before normalization or full-config rendering.

### Rules

- Only `scope: "submitted_behavior"` is currently mappable by KeyboarDeer.
- A location is valid only when the complete validator range lies inside exactly
  one behavior assignment. Structural errors, manager-owned `defcfg` errors,
  cross-assignment ranges, unknown parser prose, device conditions, conflicts,
  permissions, dependencies, and timeouts have no location.
- Keep `valid`, `rejected`, and `blocked` semantics intact. Environmental
  problems remain `blocked` and have no assignment location.
- Preserve unknown future location scopes in JSON. Clients must treat them as
  unmapped until explicitly supported.
- Do **not** accept GUI layer IDs, key names, device paths, or generated-file
  coordinates in the request. The manager returns a behavior range; the GUI maps
  that range through its own compiler source map.

### Implementation steps

1. Render model behavior with a manager-local source map from the rendered
   candidate back to submitted behavior assignment spans.
2. Extract a validator range only from deterministic parser output. Convert it
   through that map only if the entire range is one assignment.
3. Attach the digest to valid, rejected, and blocked model results. Content-mode
   preview may leave it absent unless an equivalent explicit contract is added.
4. Ensure preview remains side-effect free: no managed-store write, process
   mutation, configuration enablement, or device claim change.

### Required tests

- mapped error inside a single `deflayer` behavior assignment;
- wrapper/`defcfg` failure, structural failure, ambiguous range, and unknown
  parser prose all omit location;
- timeout, dependency, conflict, disconnected, and inaccessible device return
  `blocked` with no location;
- digest is byte-stable and changes when submitted behavior bytes change;
- absent location and unknown future scope decode/round-trip safely; and
- JSON Lines fixtures: mapped rejection, unmapped rejection, blocked response.

This work is the manager prerequisite for KeyboarDeer **VALIDATE-05/06**.

---

## 2. MGR-IDEMPOTENCY — safe create/update/lifecycle recovery

### Outcome

Every durable configuration mutation accepts an idempotency key, durably binds
it to a canonical request fingerprint, and returns the original operation/result
for a retry. A GUI can recover from a lost response without guessing whether a
mapping was applied.

### Scope

Apply this to at least:

- `configuration.create`;
- `configuration.update`;
- `configuration.set_enabled`;
- `configuration.delete`; and
- `configuration.adopt`.

Do not claim retry safety for any route until that route uses the durable record.
Read-only calls and `validation.preview` do not need idempotency keys.

### Contract

- Require a non-empty, bounded opaque `idempotency_key` for these mutation
  routes. Reject missing/oversized values with `invalid_request`.
- Canonicalize the method and complete request parameters into a stable request
  fingerprint. Never use JSON field order as identity.
- The same key with the same method/fingerprint returns the original accepted
  operation/result, including after a manager restart.
- The same key with a different method/fingerprint returns
  `idempotency_conflict`; it must never execute a second mutation.
- Persist the key → fingerprint → operation ID/result relationship atomically
  before replying that a mutation was accepted.
- Retain records for at least the lifetime of retained operations, with a
  documented bounded cleanup/retention policy.

### Operation and disconnect semantics

1. Allocate and persist the operation before beginning irreversible work.
2. Associate every state transition, final configuration revision, activation
   result, and rollback result with that operation.
3. Once accepted, mutation execution must not be cancelled merely because the
   client socket closes. Request deadlines may bound admission/validation, but
   an accepted operation is manager-owned thereafter.
4. `operation.get`, `snapshot.get`, and duplicate idempotent requests must all
   agree on the final/ongoing operation state.
5. Preserve existing expected-revision behavior. A new key with a stale expected
   revision is rejected normally; replaying an already accepted matching key
   returns its original result instead of rechecking the current revision.

### Storage design

Use an application-private, atomic store adjacent to manager durable state, with
0600 file permissions and a versioned schema. Do not place the key in external
`.kbd` files. Store only opaque key/fingerprint metadata and public operation
data; never store client paths or GUI profile information.

### Required tests

- duplicate create/update/lifecycle/adopt request returns the same operation and
  causes one write/process transition;
- duplicate request after manager restart returns the stored operation/result;
- same key, different payload/method fails with `idempotency_conflict`;
- lost client response does not cancel accepted apply; a later duplicate recovers
  it;
- stale revision with a new key remains rejected;
- rollback success/failure and activation failure remain queryable after restart;
- malformed/missing/oversized key is rejected before mutation; and
- retention cleanup never removes an operation while its key is still replayable.

This completes the manager side of KeyboarDeer **APPLY-02/03** and makes apply
recovery testable.

---

## 3. MGR-CONTENT — safe external reads and managed export

### Outcome

Expose manager-owned content only through explicit same-user API methods. The
GUI never reads manager paths directly and never invents a device-specific
`defcfg`.

### A. External content read

Add a capability such as `configuration_content_read` and a method such as
`configuration.content.get`:

```json
// request
{ "configuration_id": "opaque-id", "expected_revision": 7 }

// response
{
  "configuration_id": "opaque-id",
  "ownership": "external",
  "content_revision": 7,
  "digest": "sha256:…",
  "content": "…"
}
```

Rules:

- same-user Unix-socket access only; no filesystem path is returned;
- reject unknown IDs, content that changed during reading, oversized content,
  and unsupported ownership with structured errors;
- enforce the existing size limit and return a digest/revision so GUI views can
  discard stale text;
- external reads are read-only and never imply visual import, adoption, or edit
  permission; and
- decide and document whether managed source is readable. The recommended v1
  policy is **external source only**; managed export uses the separate route
  below.

### B. Managed export

Add a capability such as `configuration_export` and a method such as
`configuration.export` with an explicit format:

```json
{ "configuration_id": "opaque-id", "format": "manager_rendered_kbd" }
```

Return content plus configuration ID, revision, digest, and a format label. A
`manager_rendered_kbd` export is a manager-rendered artifact for that manager
and device binding, not a portable GUI profile. It may contain manager-owned
input/output forms. If a portable behavior/model format is later needed, define
it as a separate format rather than silently changing this one.

### Required tests

- authorization/same-user transport policy, unknown ID, external read-only,
  size limit, and changed-during-read errors;
- no returned filesystem paths or host handles;
- export is deterministic for a fixed managed revision and includes its digest;
- external content read/export creates no configuration, operation, process, or
  device mutation; and
- unknown future format/capability values remain safely rejectable.

This unblocks the content portion of **EXTERNAL-01** and manager prerequisites
for **IO-01**. It does not make arbitrary `.kbd` visual import in scope.

---

## 4. MGR-ACCEPTANCE — prove the contracts

Before release:

1. Update `wiki/Manager-API-v1.md`, CLI/API help, and capability metadata to
   reflect only implemented behavior.
2. Add versioned JSON Lines fixtures for validation locations, idempotent
   replay/conflict/restart, content read, and export.
3. Run socket-level tests for frame/deadline/disconnect behavior and manager
   restart persistence.
4. Run Linux/evdev acceptance tests with two physical keyboards: identify,
   hotplug, one-device apply, GUI-disconnect/lost-response recovery, rollback,
   and continued headless supervision.
5. Publish the manager revision/capabilities required by KeyboarDeer and retain
   backward-compatible optional fields for older clients.

## Suggested commit sequence

1. `feat: add validation candidate digests and diagnostic locations`
2. `test: cover validation location mapping and fixtures`
3. `feat: persist idempotent configuration mutation records`
4. `feat: replay accepted configuration operations by idempotency key`
5. `test: cover idempotent mutation recovery and rollback`
6. `feat: expose access-controlled configuration content and export`
7. `test: cover configuration content and export contracts`
8. `docs: publish manager integration contracts and required capabilities`

## Definition of done

- KeyboarDeer can map only trustworthy rejected preview diagnostics to one
  assignment, with a candidate digest.
- Retrying a lost-response mutation with the same key is safe across a manager
  restart and returns its original operation.
- External content and managed artifacts are available only via explicit,
  bounded manager APIs, without exposing paths or granting edit/import rights.
- Existing snapshots/events/device ownership behavior remains compatible.
- All new contracts have deterministic JSON Lines fixtures and socket-level
  restart/disconnect coverage.
