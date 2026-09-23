# VALIDATE-05/06 implementation handover

This plan is intentionally specific enough for an implementation agent. It
covers only **VALIDATE-05** (targeted recovery) and **VALIDATE-06** (the
corresponding race and recovery test matrix).

## Product outcome

When a complete-draft preview is rejected and the manager identifies an exact
assignment, KeyboarDeer offers a **Revert [key]** action. It restores only that
assignment, retains every unrelated edit, records the change in undo history,
and previews the resulting complete draft again.

When the manager cannot identify an exact assignment, KeyboarDeer shows a
keymap-wide issue. It must **not** blame the last clicked key or offer a
targeted revert.

This is draft recovery only. It never alters an active mapping and never asks
the GUI to perform manager rollback.

## Current implementation and constraints

Relevant current code:

- `frontend/src/App.svelte` schedules complete-draft preview after semantic
  edits, serializes preview requests, and invalidates a result when the draft
  revision, manager server ID, snapshot revision, or capability environment
  changes.
- `app.go:PreviewProfile` compiles the persisted profile, calls
  `validation.preview`, and returns the compiler `SourceMap` with the
  revision-bound result.
- `internal/compiler/compiler.go` maps generated `deflayer` slot spans to
  `{layer_id, source_key}`.
- `internal/profile/profile.go` and `internal/profile/store.go` own profile
  persistence and revision checks.
- `internal/managerapi/types.go` represents diagnostics, but current manager
  diagnostics contain severity/reason/remediation/resource only. They do **not**
  promise a physical-key, layer, or generated-text location.

Do not use display names, diagnostic prose, `configured_by`, KMonad logs, or
manager files to guess an offending assignment. See `docs/live-validation.md`
and `docs/manager-api-status.md` for the ownership and source-location rules.

## Gate 0 — establish a reliable diagnostic-location contract

VALIDATE-05 cannot provide a per-key revert until at least one of these is
available:

1. The manager returns structured `{layer_id, source_key}` data for a submitted
   behavior-model diagnostic; **or**
2. The manager returns a stable generated-behavior range, and KeyboarDeer maps
   that range through the exact `ProfilePreview.SourceMap` returned for the same
   candidate.

The preferred contract is structured node data, for example:

```json
{
  "id": "diag_opaque",
  "severity": "error",
  "reason_code": "…",
  "summary": "…",
  "remediation": "…",
  "location": {
    "kind": "assignment",
    "layer_id": "base",
    "source_key": "caps"
  }
}
```

The location must describe the exact behavior candidate supplied by the GUI.
Unknown `kind` values, malformed coordinates, mismatched candidate identity,
and ranges spanning multiple assignments are **unmapped** diagnostics.

### Deliverables for Gate 0

1. Extend manager API fixtures and `internal/managerapi` types with an optional
   `DiagnosticLocation`; retain unknown fields/enums safely.
2. Extend `frontend/src/desktop.ts` with the same optional wire shape.
3. Add a diagnostic adapter that yields either:
   - `MappedIssue { layerID, sourceKey, diagnostic }`; or
   - `UnmappedIssue { diagnostic }`.
4. Add tests proving that only contract-valid locations map to a key. Text-only
   diagnostics and unknown resources must remain unmapped.

Do not start the targeted-revert UI before this gate is met. It is acceptable to
ship keymap-wide diagnostics without a revert button.

## VALIDATE-05 implementation

### 1. Persist validation provenance without changing the draft revision

Add an application-owned validation checkpoint to `profile.Profile`, or store
it alongside the profile in the same atomic profile-store document. It must be
written with a revision-guarded store method analogous to `SetApplyState`, not
through the normal `Upsert` path: recording validation metadata must not count
as a user draft edit.

Suggested schema:

```go
type ValidationCheckpoint struct {
    DraftRevision      uint64       `json:"draft_revision"`
    CandidateDigest    string       `json:"candidate_digest"`
    ManagerServerID    string       `json:"manager_server_id"`
    StateRevision      uint64       `json:"state_revision"`
    EnvironmentKey     string       `json:"environment_key"`
    Assignments        []Assignment `json:"assignments"`
    ValidatedAt        time.Time    `json:"validated_at"`
}
```

Requirements:

- Compute `CandidateDigest` from the exact compiled behavior text, using a
  stable digest such as SHA-256. Do not use a display string.
- Save a checkpoint only after a `validation.valid` response still matches the
  current profile revision, candidate digest, manager server ID, and validation
  environment.
- Keep a per-assignment pre-edit fallback in application state/storage before a
  semantic assignment change. It is labelled **Assignment before these edits**;
  it is not described as validated.
- Clear/invalidate checkpoint availability when its environment identity no
  longer matches the current manager connection/state/capabilities.
- Add migration behavior for existing profile files: missing checkpoints are
  valid and simply mean that no validated fallback is available.

### 2. Add a guarded backend revert operation

Prefer a thin Wails binding over frontend-only mutation so the store can enforce
all guards atomically. Suggested API:

```go
type RevertAssignmentRequest struct {
    ProfileID              string `json:"profile_id"`
    LayerID                string `json:"layer_id"`
    SourceKey              string `json:"source_key"`
    ExpectedDraftRevision  uint64 `json:"expected_draft_revision"`
    ExpectedCurrentValue   string `json:"expected_current_value_digest"`
    CheckpointDraftVersion uint64 `json:"checkpoint_draft_revision"`
}
```

The operation must:

1. Load the current profile from the store.
2. Verify all request guards and the checkpoint environment/candidate identity.
3. Verify that the affected layer/source key still exists and that the fallback
   behavior has no missing alias, macro, or layer dependency.
4. Replace or remove **only** the target assignment. Removing an explicit Base
   assignment restores its original source key; removing an overlay assignment
   restores transparent fall-through.
5. Save through the normal draft-edit revision path so it enters undo history
   once undo/redo exists.
6. Return the saved profile. The frontend immediately schedules a new full
   preview.

Never silently revert, replace the entire draft with the checkpoint, recreate a
deleted layer, or retry against a stale revision.

### 3. UI flow

In `frontend/src/App.svelte`:

1. Display mapped issues on the affected key/layer and add a **Show key**
   control that selects that key and layer without moving focus unexpectedly.
2. For a mapped issue, show one of:
   - **Last validated assignment: [description]** and a Revert button; or
   - **Assignment before these edits: [description]** and a clearly less
     authoritative Revert button.
3. Disable/remove the control immediately after any edit that breaks its guard.
4. Show unmapped issues only at keymap level. Do not render a key marker or
   targeted revert.
5. Announce rejection/recovery outcome once through an appropriate live region;
   do not steal keyboard focus when async preview completes.

## VALIDATE-06 test matrix

Use deterministic manager socket fixtures for protocol behavior and Playwright
for user-visible flows. Add focused Go tests for profile-store atomicity and
compiler/source-map mapping.

| Scenario | Required assertion |
| --- | --- |
| Rapid edits | Only latest candidate can update UI/checkpoint; older response is ignored. |
| Concurrent preview queue | At most one preview is in flight per device and globally; only newest queued candidate runs. |
| Device switch | A result for device A cannot affect device B. |
| Manager reconnect/server ID change | Prior valid result and checkpoint are invalidated; fresh preview is required. |
| Snapshot/capability change | Prior success disappears immediately; stale response cannot restore it. |
| Mapped single issue | Marker, Show key, guarded revert, one-assignment mutation, and re-preview work. |
| Multiple mapped issues | Each control targets only its own current assignment. |
| Unmapped issue | Keymap-level explanation only; no guessed key/revert. |
| Missing fallback dependency | Revert is unavailable with a clear explanation; no deleted alias/macro/layer is recreated. |
| Repeat bad edit | Old revert controls are invalidated; new pre-edit fallback is correctly captured. |
| Revert then undo | Revert is a normal semantic edit and is previewed again; undo does not restore an invalid stale checkpoint. |
| Blocked/timeout/transport failure | No invalid-key marker or targeted revert; edit remains available. |
| Profile/store restart | Valid checkpoint survives when its identity remains current; stale/unknown checkpoint is rejected safely. |

## Suggested commit sequence

1. `feat: add validation diagnostic location types and fixtures`
2. `feat: persist revision-bound validation checkpoints`
3. `feat: map reliable validation diagnostics to assignments`
4. `feat: add guarded assignment recovery`
5. `test: cover validation races and recovery guards`
6. Update `TODO.md` only after the Gate 0 contract and every acceptance row
   above passes.

## Definition of done

- No targeted recovery is offered from an unmapped diagnostic.
- A valid checkpoint is revision-, candidate-, manager-, and environment-bound.
- Revert mutates only one guarded assignment and revalidates the whole draft.
- Blocked, timeout, and transport failures never appear as invalid key edits.
- All entries in the test matrix pass in CI.
- `TODO.md` can truthfully mark both VALIDATE-05 and VALIDATE-06 complete.
