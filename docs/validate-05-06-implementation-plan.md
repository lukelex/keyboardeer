# Manager handover: validation locations for VALIDATE-05/06

This handover is for **`kmonad-device-manager`**, not KeyboarDeer. Its purpose
is to remove the manager-side blocker for KeyboarDeer tasks **VALIDATE-05**
(safe per-key recovery) and **VALIDATE-06** (its recovery/race test suite).

## The problem to solve

`validation.preview` currently returns outcome, reason, remediation, and an
optional resource. That is sufficient for a keymap-wide result but not for a
per-key result: a resource or KMonad error message does not reliably identify a
physical source key or a behavior assignment.

KeyboarDeer must not infer a key from:

- the last clicked key;
- a configuration or device resource ID;
- a display name;
- KMonad diagnostic prose; or
- manager logs/files.

Without a reliable location, KeyboarDeer can show only a keymap-wide rejection.
It cannot safely offer **Revert [key]**.

## Manager deliverable

Extend `validation.preview` diagnostics with an optional location that identifies
a span in the **submitted behavior text**, not in the manager-rendered full
KMonad configuration.

Recommended wire shape:

```json
{
  "validation": {
    "outcome": "rejected",
    "candidate_digest": "sha256:…",
    "diagnostics": [
      {
        "id": "diag_opaque",
        "severity": "error",
        "reason_code": "kmonad_parse_error",
        "summary": "…",
        "remediation": "…",
        "location": {
          "scope": "submitted_behavior",
          "start_line": 14,
          "start_column": 3,
          "end_line": 14,
          "end_column": 31
        }
      }
    ]
  }
}
```

### Contract rules

1. `location` is optional. Its absence means **unmapped**, not a default key.
2. `scope: "submitted_behavior"` is mandatory for a GUI-mappable location. Line
   and column values are 1-based, half-open at the end, and refer exactly to the
   UTF-8 behavior string supplied in `{model: {device_id, behavior}}`.
3. The manager must translate locations from any generated full configuration
   back through its manager-owned `defcfg` wrapper. Do not expose generated-file
   coordinates as submitted-behavior coordinates.
4. Emit a location only when the manager can establish it reliably. Errors in
   manager-owned `defcfg`, device rendering, output setup, permissions,
   unavailable devices, conflicts, timeouts, or process/runtime state must have
   no assignment location.
5. A range covering multiple behavior forms, a whole `deflayer`, or an unknown
   region must be omitted rather than approximated.
6. `candidate_digest` is a SHA-256 digest of the exact submitted behavior
   string, prefixed `sha256:`. It lets clients reject a response accidentally
   associated with another candidate. The existing JSON Lines request ID remains
   the request/response correlation mechanism.
7. Unknown future `scope` values are allowed. Clients must treat them as
   unmapped unless explicitly supported.

## Outcome semantics the manager must preserve

| Outcome | Meaning | Key location allowed? |
| --- | --- | ---: |
| `valid` | Candidate passed manager/KMonad validation. | No need. |
| `rejected` | The submitted behavior is invalid. | Yes, only when exact. |
| `blocked` | Environment prevents validation: device, conflict, permission, dependency, timeout, or manager condition. | No. |

The manager must not turn an environmental condition into `rejected` merely to
attach an error. KeyboarDeer uses this distinction to avoid marking a user key
invalid when the keyboard is disconnected or inaccessible.

## Implementation approach in the manager

Relevant manager-owned pipeline:

```text
submitted behavior model
  → manager renders platform-owned defcfg + behavior
  → KMonad/parser validation
  → manager translates diagnostics
  → validation.preview response
```

1. Capture the submitted behavior text before rendering the complete candidate.
2. When rendering the full candidate, retain a source map from each byte/line
   region in the submitted behavior to its region in the rendered candidate.
   The map must account for inserted `defcfg` text and any manager-owned forms.
3. Adapt validator/parser diagnostics through that map. If a diagnostic range is
   fully contained in one mapped submitted-behavior region, return the submitted
   range. Otherwise omit `location`.
4. Compute the digest from the original submitted behavior bytes, before any
   normalisation or manager rendering.
5. Leave existing `resource`, `reason_code`, `summary`, and `remediation`
   fields intact for backward compatibility.
6. Do not add device-file, output-form, profile, GUI-layer, or GUI-source-key
   fields to the manager request. Those are KeyboarDeer-owned concepts. The GUI
   maps a submitted-behavior span through its own compiler source map.

## Manager test requirements

Add deterministic unit/integration tests in `kmonad-device-manager` for:

1. **Exact behavior error:** a validator error inside a submitted `deflayer`
   behavior yields `scope: submitted_behavior`, a correct 1-based range, and
   the correct candidate digest.
2. **Wrapper error:** an error in manager-rendered `defcfg` has no location.
3. **Environmental block:** disconnected/inaccessible/conflicting device,
   dependency failure, and timeout return `blocked` with no location.
4. **Ambiguous range:** an error spanning forms or an untranslatable KMonad
   range has no location.
5. **Digest stability:** digest is deterministic for identical bytes and changes
   when behavior bytes change.
6. **Compatibility:** diagnostics without a location remain valid API responses;
   unknown future location scopes round-trip safely.
7. **No side effects:** `validation.preview` still does not persist a
   configuration, enable a binding, or start/reload a mapping.

Add a JSON Lines fixture that KeyboarDeer can consume for one mapped rejection,
one unmapped rejection, and one blocked result.

## Explicit non-goals for the manager

The manager must **not** implement any of the following for VALIDATE-05/06:

- GUI profile checkpoints or undo history;
- restoring a GUI assignment;
- choosing which key to revert;
- parsing KeyboarDeer profile storage;
- device-specific `defcfg` input supplied by the GUI; or
- automatic rollback of a currently running mapping because preview failed.

Those remain KeyboarDeer responsibilities after it receives a reliable location.

## Acceptance gate for KeyboarDeer

Manager v1.1.0 (`712f4aa`) implements the location/digest contract and includes
`tests/fixtures/validation-preview-locations.jsonl` for mapped, unmapped, and
blocked responses. KeyboarDeer now enables per-assignment recovery only when the
manager digest matches the exact local candidate and a submitted-behavior range
maps to exactly one compiler source-map entry.

The KeyboarDeer VALIDATE-05 regression coverage verifies:

- a mapped rejection marks and focuses only its mapped assignment;
- **Revert [key]** restores the last validated value, keeps unrelated edits,
  records undo/redo, and triggers full-draft validation;
- pre-edit fallback is available without a checkpoint and refuses to recreate
  a removed layer dependency;
- unmapped, unknown-scope, ambiguous, or digest-mismatched rejections never
  produce a key marker or targeted revert; and
- blocked results never produce a key marker or targeted revert.

The KeyboarDeer VALIDATE-06 regression coverage also verifies:

- stale preview results are discarded after manager state/capability changes,
  newer draft generations, disconnect, or profile/device switching;
- reconnect schedules validation for the unchanged draft, while stale responses
  from the disconnected environment cannot restore a validity claim;
- rapid edits during an in-flight preview retain only the latest candidate;
- multiple mapped diagnostics can be navigated and recovered one at a time
  across different layers, without losing the other invalid or valid edits;
- a second invalid edit after recovery uses the refreshed valid checkpoint; and
- missing provenance and checkpoints from another manager server do not enable
  targeted recovery.

These cases are covered in `frontend/tests/workspace.spec.ts`, alongside the
manager JSON Lines compatibility fixture. `PreviewProfile` also rejects a
candidate when the manager server, state revision, or capabilities change during
validation, so an environment-raced success cannot be persisted as a checkpoint.
