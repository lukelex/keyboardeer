# KeyboarDeer completion checklist

**Current interface scope:** the seven-screen keyboard-draft workspace in
[the high-fidelity prototype](docs/design/high-fidelity-workspace.html).
Profiles and Review & Apply are parked; related tasks below are retained as
future product backlog rather than work for the current design iteration.
Automatic whole-keymap preview after each edit and targeted invalid-key recovery
are active scope; see [the interaction plan](docs/live-validation.md).

This is the delivery checklist for an installable **Linux v1**, followed by
explicit expansion work toward the cross-platform product. A checked design or
planning item does not mean the application feature is implemented.

Dependencies refer to the [manager API audit](docs/manager-api-status.md),
reconciled with manager `origin/main` `712f4aa` / v1.1.0 on 2026-09-24. The
[roadmap](docs/gui-integration-roadmap.md) explains sequencing; this file is the
place to track completion.

## Completed foundations

- [x] Select Wails + Go + Svelte 5 + TypeScript and establish ownership boundaries.
- [x] Create editable branding and app icon assets.
- [x] Produce low-fidelity wireframes before the high-fidelity prototype.
- [x] Prototype devices, key editing, layers, review, identification, and failure states.
- [x] Audit every API v1 method against pinned upstream source; correct the stale
  claim that all resource methods are unavailable.
- [x] Prototype subtle live-valid status, actionable invalid-key diagnostics,
  and selective assignment revert without discarding other draft edits.

## P0 — Bootstrap and real API integration

- [x] **APP-01** Select and pin supported Wails/Go/Node/package-manager versions;
  scaffold the Svelte 5 TypeScript app and document Linux development prerequisites.
- [x] **APP-02** Establish formatting, lint/type checks, unit-test commands,
  build commands, lockfiles, and CI from a clean checkout.
- [x] **API-01** Implement a Go socket client: endpoint discovery, JSON Lines,
  bounded frames, request correlation, deadlines, transport failures, reconnect
  backoff, and resource cleanup on GUI exit.
- [x] **API-02** Negotiate hello on every connection, track server identity,
  handle unsupported versions, and expose a small typed Wails bridge to Svelte.
- [x] **API-03** Define Go/domain/frontend types and contract fixtures, including
  unknown fields/enums, structured errors, unavailable capabilities, and timeouts.
- [x] **API-04** Add an explicit integration harness for implemented device list,
  identify start/cancel, identification operation polling, and model preview.
  Prove these calls against the supported manager revision, not just mocks.
- [x] **API-05** Implement normal capability negotiation using `manager.get`;
  show API-incomplete when unsupported and never silently enable features.
  Manager contract is implemented in v1.1.0 (`manager.get`).
- [ ] **DESIGN-01** Review the prototype with first-time users; validate key
  selection, draft/live distinction, and blocked/rejected recovery.

**Exit:** reproducible desktop build, typed real transport, explicit fixture mode,
and useful unavailable/incompatible-manager states. No direct input or process
supervision code in KeyboarDeer.

## P1 — Devices and runtime visibility

- [x] **DEV-01** Implement the Devices view with loading, empty, disconnected,
  inaccessible, unsupported, conflict, and manager-unavailable states.
- [x] **DEV-02** Join authoritative devices/configurations/diagnostics by opaque
  IDs; separate device availability, desired revision, active revision, and
  runtime health. Never infer active profiles from `configured_by` names.
  Manager contract is implemented in v1.1.0 (`snapshot.get`).
- [x] **DEV-03** Show external configurations as read-only and preserve
  per-resource diagnostics and remediation.
- [x] **DEV-04** Integrate bounded identification, countdown, cancellation,
  timeout/hotplug/conflict handling, and operation polling; explain that only
  the chosen mapping may pause. Manager support is capability-gated at runtime.
- [x] **STATE-01** Add bounded snapshot refresh while events are unsupported;
  mark stale state on disconnect rather than presenting it as live health.
- [x] **STATE-02** Add events with a gap-free snapshot handoff, replay cursor,
  unknown-event tolerance, manager restart handling, and resync after backlog.
  Manager contract is implemented in v1.1.0 (`events.subscribe`).

**Exit:** available keyboards and runtime state are understandable without a
terminal, and reconnect restores an authoritative view.

## P1 — Profiles, geometry, and visual editor

- [x] **PROFILE-01** Define a versioned profile schema: local profile ID,
  manager device/configuration references, geometry and source-key order,
  layers, key behaviors, aliases, macros, and compiler settings.
- [x] **PROFILE-02** Persist profiles and drafts atomically in application-owned
  storage; cover migrations, corrupted files, recovery, and reopen after a crash.
- [x] **PROFILE-03** Add create/rename/duplicate/delete/switch workflows for
  multiple profiles and keyboards, preserving pending edits per profile.
- [x] **GEOMETRY-01** Provide verified layouts and explicit selection; map every
  drawn key to a source key without guessing from a product name. Source mapping
  evidence and the ANSI 60% correction/migration are documented in
  [`geometry-verification.md`](docs/geometry-verification.md).
- [x] **EDIT-01** Implement keyboard rendering, selection, bottom action palette, key search,
  single-key remapping, restore-original, undo/redo, and persistent draft status.
- [x] **EDIT-02** Implement visible layer create/rename/delete/reorder controls
  in Manage layers, transparency, reachability, and layer-switch behaviors;
  previews must not change live state.
- [x] **EDIT-03** Add tap/hold behavior with explicit timing semantics and
  defaults; explain how to reach/exit layers before applying a profile.
- [x] **COMPILE-01** Compile deterministically to platform-neutral behavior
  (`defsrc`, `deflayer`, supported aliases); reject invalid references, duplicate
  identifiers, inconsistent source counts, and unsupported behaviors locally.
- [x] **COMPILE-02** Verify representative generated behavior against KMonad;
  never emit device-specific `defcfg` or parse generated output as editor state.

**Exit:** a user can reopen and edit a saved profile, add a reachable layer,
and obtain deterministic behavior without writing KMonad syntax.

## P1 — Continuous preview and per-key recovery (active)

Implementation handover for the remaining recovery work:
[`validate-05-06-implementation-plan.md`](docs/validate-05-06-implementation-plan.md).

- [x] **VALIDATE-01** Connect `{model: {device_id, behavior}}` to
  `validation.preview`; map diagnostics to the relevant editor fields where
  possible. Check the entire compiled candidate automatically after semantic
  edits; coalesce rapid input and bound per-device/global preview concurrency.
  Separate valid, rejected, blocked, timeout, and transport errors.
- [x] **VALIDATE-02** Invalidate success immediately after draft or environment
  changes. Correlate responses with draft revision, device, candidate, manager
  connection, and environment generation. Ignore stale/out-of-order responses;
  avoid duplicate checks for pure selection. Never imply validity means active.
- [x] **VALIDATE-03** Build compiler node/source mapping and a diagnostic adapter.
  Use only reliable manager locations; general errors must not blame the last
  clicked key. Coordinate structured key/source metadata upstream if necessary.
- [x] **VALIDATE-04** Implement quiet valid/checking status, prominent rejection
  with causes/remedies, affected keys and layer counts, accessible announcements,
  and issue-to-key navigation. Separate environmental blockage from bad edits.
- [x] **VALIDATE-05** Keep last validated assignment provenance and per-key
  pre-edit fallback. Revert only an identified offending assignment with current
  revision/value guards, preserve unrelated edits, protect missing dependencies,
  record undo, and revalidate the complete draft. Do not silently auto-revert.
- [x] **VALIDATE-06** Verify rapid edit races, device switching, reconnect,
  capability changes, cross-layer/multiple issues, partial recovery, repeated bad
  edits, revert/undo, unavailable checkpoints, and unmapped diagnostics.

## P1 — Apply and lifecycle (parked)

- [x] **APPLY-01** Implement a human-readable review diff and explicit apply;
  distinguish local draft saved, candidate accepted, and active/healthy.
- [x] **APPLY-02** Integrate managed create/update with configuration association,
  idempotency keys, expected revisions, uncertain-response recovery, and
  refresh-and-review for `stale_revision`. Manager contract is implemented in
  v1.1.0.
- [x] **APPLY-03** Track accepted operations through reconnect/GUI restart;
  show rejection, rollback succeeded/failed, and the actual active revision.
  Closing the GUI must not cancel accepted apply.
- [x] **LIFE-01** Add enable/disable/delete for managed configurations with clear
  effects on the selected keyboard; local profile deletion and runtime deletion
  must be explicit, distinct operations.
- [x] **IO-01** Import/export versioned GUI profiles with validation and expose
  generated-config export through the manager's `configuration.export` API.
  Portable `.kbdprofile.json` v1 and the manager-rendered `.kbd` save/view flow
  are implemented. External raw source is read only through the manager's
  revision-checked content API. Never present behavior-only profile data as a
  runnable device-specific `.kbd` file.
- [x] **EXTERNAL-01** Display external runtime state and, when supported, raw
  configuration content. Full arbitrary `.kbd` visual import is outside v1.
  The content API is accessed through the manager's revision-checked GUI flow.

**Exit:** edit → preview → apply works for one keyboard without disturbing
another, and failed changes do not falsely appear as active.

## P2 — Usability and release quality

- [x] **UX-01** Complete keyboard navigation, useful accessible names, focus
  restoration, screen-reader announcements, contrast, scalable type, 200% zoom,
  small-window behavior, and reduced motion.
- [x] **UX-02** Provide first-run setup, missing-manager guidance, structured
  diagnostics, supported-feature explanations, and concise contextual help.
- [x] **DESKTOP-01** Add app identity/icons, window-state persistence, and
  documented close/quit behavior; decide whether a tray adds value to v1.
- [x] **TEST-01** Cover socket framing, concurrent response matching, deadlines,
  unknown schema fields, incomplete APIs, disconnect/reconnect, and resync.
- [x] **TEST-02** Cover profile migration/recovery, compiler semantics, layer
  references, undo/redo, preview invalidation, and per-keyboard draft isolation.
- [x] **TEST-03** Exercise validation rejection, blocked devices, stale revisions,
  lost apply response, rollback, disabled mappings, and operation recovery with
  a manager integration fixture.
- [ ] **TEST-04** Verify on actual Linux keyboards: identify, hotplug, two-device
  isolation, GUI close/crash during apply, and continued headless supervision.
- [x] **RELEASE-01** Build/package the Linux desktop app in CI; document runtime
  dependencies, supported manager revision/capabilities, install, update, and
  uninstall. Publish reproducible versioned artifacts and checksums.
- [ ] **RELEASE-02** Run the end-to-end acceptance workflow from a clean install,
  record supported layouts/behaviors and known limitations, then tag v1.

## Upstream gates — owned by kmonad-device-manager

These are dependencies to coordinate, not functionality to duplicate in the GUI.
Manager implementation handover:
[`manager-improvement-plan.md`](docs/manager-improvement-plan.md).

- [x] **MGR-01** Implement capability/health/version reporting via `manager.get`.
- [x] **MGR-02** Implement authoritative snapshots, desired/active/runtime/
  operation separation, structured diagnostics, and persisted known-device
  inventory.
- [x] **MGR-03** Implement managed lifecycle, durable idempotency, revision
  checks, last-known-good rollback, activation confirmation, and queryable
  operations while preserving external files.
- [x] **MGR-04** Implement ordered events, retained replay, snapshot cursors,
  resynchronization, and non-blocking slow-client handling.
- [x] **MGR-05** Define and implement revision-checked external content reads and
  manager-rendered managed `.kbd` export with explicit ownership/rendering
  boundaries. GUI use of these methods remains tracked under IO-01/EXTERNAL-01.
- [x] **MGR-06** Offer a read-only, capability-gated device input-capability scan
  that attests a versioned key-token set for a connected device, with optional
  bounded single-key probe. Facts only: no layout/product inference, no mapping
  change. Handover:
  [`layout-detection-plan.md`](docs/layout-detection-plan.md).

## After Linux v1 — full product expansion

- [ ] Additional verified ANSI/ISO/JIS, split, full-size, and laptop geometries;
  custom geometry editing and source-key mapping.
- [ ] **GEOMETRY-02** Narrow the verified geometry from the manager-attested key
  set with explicit confirmation, never a silent guess; keep evidence
  machine-local. Handover:
  [`layout-detection-plan.md`](docs/layout-detection-plan.md).
- [x] **GEOMETRY-03 (seed additions)** Expand the verified catalog layout-first —
  ISO 60%, ISO TKL, US ANSI 100%, and ISO 100% are verified against KMonad's
  published templates at `30b9705`, their extra tokens are gated in the
  compiler, and every layout passes the real KMonad dry-run conformance.
- [x] **GEOMETRY-03 (laptop conventions + vocabulary)** Add layout-first laptop
  conventions `laptop-iso-93-v1` (X220: 102nd key) and `laptop-iso-87-v1`
  (T430: no 102nd key) at their published US `defsrc` orders, both passing the
  real dry-run. Build the verified KMonad token vocabulary
  (`internal/geometry/kmonad_vocabulary.go`, generated from `Keycode.hs` at
  `30b9705`) and make it the compiler's key gate, with pinned-count and
  containment tests.
- [ ] **GEOMETRY-03 (continuation)** Authored 65/75/96, ortholinear, and
  split-ergo conventions, plus a parametric position builder. The verified
  `split-94-v1` rename, legacy alias, and store migration are complete;
  Kinesis-specific presentation now belongs to the community device catalog.
  Handover:
  [`geometry-catalog.md`](docs/geometry-catalog.md).
- [ ] Advanced aliases/macros, behavior composition, timing controls, and visual
  explanations with compiler and KMonad conformance coverage.
- [ ] Explicit representable external adoption when `configuration.adopt` is
  implemented; preserve unsupported syntax and ownership boundaries.
- [ ] macOS and Windows manager backends/transports, capability reporting,
  native packaging, and the same lifecycle/isolation acceptance suite.
- [ ] Revisit dark mode, localization, and profile sharing after validating
  demand and the core editing workflow.

## Definition of done

Linux v1 is complete when the P0–P2 application items and their upstream gates
are checked, CI passes, and a new user can identify a keyboard, select its
geometry, save a profile, remap a key and layer, preview/apply it, understand
failures, and recover after reconnect. Existing external mappings and unrelated
keyboards remain intact; closing the GUI leaves supervision to the manager.
Cross-platform completion additionally requires the backend and packaging
expansion items above.
