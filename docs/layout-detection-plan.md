# Layout detection plan

This is the design for automatically narrowing the keyboard geometry from a
real physical device, without crossing the manager/GUI ownership boundary
defined in [`project-description.md`](project-description.md) and reinforced in
[`AGENTS.md`](../AGENTS.md). It is backlog work for **after Linux v1**, because
it depends on the expanded verified-geometry catalog and real-device test
coverage that v1 establishes.

Current related items:

- [x] [`GEOMETRY-01`](../TODO.md): verified layouts and **explicit selection**;
      the GUI never guesses a template from a device name.
- [ ] After v1: additional verified ANSI/ISO/JIS, split, full-size, and laptop
      geometries; custom geometry editing.
- [x] [`TEST-04`](../TODO.md) (tracked): real-keyboard identify/hotplug
      coverage — the harness baseline detection reuses.

## 1. What is detect-able and what is not

The split that makes detection honest:

- **Existing keys are a factual, manager-attestable property.** A Linux/evdev
  device exposes the set of key events it can emit (capability bits). "This
  keyboard physically has these keys" is a platform-input fact, owned by the
  manager.
- **Physical shape is under-determined by key sets.** The set does not tell you
  key sizes, row staggering, ANSI-vs-ISO Enter shape (when the 102nd key is
  absent), split-vs-monoblock, laptop layout, or Fn-layer behavior.
- **Detection therefore narrows to candidate verified templates and requires
  explicit confirmation.** It never claims to sniff the physical shape, and it
  never selects a layout silently.

## 2. Ownership boundary

### Manager owns (attestation)

- Reading platform key-capability evidence for a connected input device
  (`EVIOCGBIT(EV_KEY)`-class reads on the platform layer behind the same-user
  API).
- Producing a **versioned, opaque key-token set** for that device in the same
  vocabulary the manager already uses for input representation.
- Any interactive probe that needs the user to press a key (see §4), bounded
  and non-destructive.
- Deciding when the attestation is stale (device identity changed, hotplug).

The manager returns facts only. It does **not**:

- return a layout name, template, or product inference;
- guess a geometry from a device name — never, including inside the manager;
- treat the scan as a mapping change, configuration mutation, or device claim.

### GUI owns (interpretation)

- The verified geometry catalog and each template's expected KMonad source-key
  set (already derivable from `geometry.source_keys`).
- Candidate matching, scoring, and the explicit confirmation UX.
- The decision that a chosen geometry is still a verified template; detected
  tokens are never fed directly as `defsrc`.

The GUI still never opens devices, reads evdev, or builds `defcfg`/`device-file`
input configuration. The manager supplying a token set is input representation,
not geometry.

## 3. Manager-side contract (upstream gate)

Follows the existing capability-gated pattern (`device_discovery`, ...). The
names below are proposed; the manager owns the final contract.

### 3.1 Read-only key scan

New capability `device_input_scan` and read-only method `device.inputscan.get`:

```json
// request
{ "device_id": "opaque-id" }

// response
{
  "device_id": "opaque-id",
  "token_namespace": "kmonad-v1",
  "keys": ["grv", "1", "2", "tab", "q", "w", "spc", "ret", "..."],
  "unmapped_count": 2,          // physical keys with no KMonad token (vendor/media)
  "generation": 4,              // increments when device identity changes
  "digest": "sha256:...",       // of the sorted token list
  "observed_at": "..."
}
```

Rules:

- **Token vocabulary:** recommended `kmonad-v1` — the same KMonad source-key
  tokens the manager's input representation already renders. This keeps all
  platform translation manager-side and lets the GUI match pure KMonad-token
  sets against the catalog. (Alternative: raw evdev `KEY_*` names with a
  versioned GUI translation table. More GUI platform surface; only choose this
  if the manager prefers to keep keycap details opaque.)
- Read-only, side-effect free, ephemeral like identification: no idempotency
  key, no revision, no mapping pause, no config write.
- Capability-gated: an older manager simply does not advertise it; the GUI
  shows "detection unavailable" and falls back to manual selection.
- `digest`/`generation` guard stale evidence; the GUI records the accepted
  digest at confirmation time and invalidates if the device changed.
- Keys with no KMonad representation are counted (`unmapped_count`) and never
  matched against templates — media/vendor keys must not fail a candidate.

### 3.2 Optional disambiguation probe (only if needed in v1)

Some layout pairs differ by exactly one physical key that a board may or may not
ship (for example the ISO 102nd key). A bounded probe lets the GUI ask the user
to press that one key to separate the candidates:

```json
// device.inputscan.probe (capability: device_input_scan)
{ "device_id": "opaque-id", "token": "102nd", "timeout_ms": 10000 }
```

- Observer-style, like identification: the manager records only whether the
  named token arrived, discards everything else, never records typing.
- If the manager does not implement probing, detection still works — the GUI
  just presents both candidates with an explicit "what differs" explanation.

### 3.3 Manager delivery checklist for `device_input_scan`

The concrete items the `kmonad-device-manager` needs in place to satisfy §3.1
and §3.2, in delivery order:

1. **Capability advertisement** — advertise `device_input_scan` in
   `manager.get.capabilities` only when the read path is fully implemented;
   an older manager must simply not advertise it.
2. **Read-only key scan** — implement `device.inputscan.get`: reads platform
   key capabilities (Linux/evdev `EVIOCGBIT(EV_KEY)` behind the same-user
   API), returns `device_id`, `token_namespace`, `keys`, `unmapped_count`,
   `generation`, `digest`, `observed_at`. Side-effect free; no idempotency key,
   no revision, no mapping pause, no config write.
3. **Token vocabulary resolution** — fix the §3.1 fork with the GUI: confirm
   `kmonad-v1` (KMonad source-key tokens) vs raw evdev `KEY_*` names. The GUI
   and the catalog's source-key sets must share the same namespace, or the GUI
   needs a versioned translation table. (Blocking decision — make it explicit in
   the manager's API audit for `device.inputscan.get`.)
4. **Unmapped-key separation** — count physical keys with no KMonad token in
   `unmapped_count` and keep them out of `keys`; media/vendor keys must not
   break candidate matching.
5. **Staleness and identity** — bump `generation` and recompute `digest` when
   device identity changes or hotplug occurs, so the GUI can invalidate a
   proposed layout.
6. **Optional single-key probe** — implement `device.inputscan.probe` as an
   observer (records only whether the named token arrived, bounded timeout,
   never records typing). Ship without it if out of scope; detection still
   works with ranked candidates.
7. **Contract tests** — JSONL fixtures for exact/superset/subset/partial scans,
   capability-absent responses, unmapped-key counts, and stale
   generation/digest, following the existing API audit fixtures.
8. **Conformance reuse** — same-user socket, framing, and deadline conventions
   as the existing capability-gated methods; document `device_input_scan` in the
   wiki API ref.
9. **Real-device acceptance (TEST-04)** — scan must agree with the physical
   board; scan + identify on the same device must agree; probe must separate an
   ISO board from ANSI; hotplug must invalidate stale evidence.

GUI-side prerequisites that gate on these items are recorded under GEOMETRY-02;

## 4. GUI-side work

### 4.1 Catalog facets

- Compute each template's expected token set from `geometry.source_keys`,
  deduplicated (split boards repeat source codes). No new hand-maintained
  data.
- Reuse the trait metadata defined in
  [`geometry-catalog.md`](geometry-catalog.md) (`has_function_row`,
  `has_numpad`, `has_nav_cluster`, `has_arrows`, `has_iso_key`,
  `has_media_keys`, `is_split`, `is_ortholinear`, `thumb_cluster_count`).
  Candidates rank by traits first, then token diff — never by name or brand.
- Keep the "verified visual map to KMonad source" guarantee unchanged: a
  detected selection is still a catalog template.

### 4.2 Matching engine (`internal/geometry`)

Input: attested token set A (plus `unmapped_count`). For each template T with
set S:

- `missing = S − A` and `extra = A − S`.
- Classify:
  - **exact** — A and S are equal;
  - **superset** — S ⊆ A with small extras (numpad/nav/media clusters explain
    most extras);
  - **subset** — A ⊂ S (board lacks template keys, e.g. no number row);
  - **partial** — significant missing and extra keys: no verified template fits.
- Extras that belong to any catalog template's output vocabulary or media keys
  are soft; extras that indicate whole clusters (numpad) are strong signal.
- Ranking and reasons: every candidate carries counts and a readable
  per-category breakdown ("your keyboard reports a numpad; the TKL template
  does not have one"), not a bare match percentage.
- Empty/suspicious results (e.g. missing `spc` or a letter row) are never
  clamped to a best guess: they produce a "no verified template matches" state.

### 4.3 UX

- **Where:** Setup / new-draft flow, after a device is chosen, as an explicit
  "Detect layout" action alongside manual selection. Capability-gated disabled
  state otherwise.
- **Result screen:** attested key count, ranked candidates with match quality
  and expandable matched/missing/extra key lists (labels come from the
  template, tokens never shown raw to non-experts). One primary Confirm action;
  manual-selection fallback always available.
- **Confirmation is authoritative:** detection never silently overrides an
  existing draft geometry. It only proposes at draft creation or through an
  explicit "re-detect" action.
- **Evidence is not portable:** the attested set, digest, and generated camera
  state are machine-local like manager IDs; they are excluded from
  `.kbdprofile.json` export per [`profile-schema.md`](profile-schema.md).

### 4.4 Persistence (local-only)

Optionally record the attested set and digest in application-owned local state
keyed by device, so:

- re-opening a draft can warn that the physical board changed since selection
  (generation/digest mismatch), and
- the future custom-geometry editor can start from the attested "existing key"
set instead of a blank canvas.

This stays outside the portable profile document.

## 5. Sequencing and gates

Depends on, in order:

1. Additional verified geometries in the catalog (existing backlog item) so
   detection has enough candidates — ISO/ANSI/JIS, TKL/full-size, split/laptop.
2. Manager `device_input_scan` (new upstream gate, see TODO **MGR-06**) against
   the v1.1.0+ contract audit.
3. Real-device evidence base from **TEST-04** harness runs.

Proposal for [TODO.md](../TODO.md):

- Upstream gates: `[ ] MGR-06` — read-only device input-capability scan
  (capability-gated token-set attestation; §3). Manager handover lives here.
- After Linux v1: `[ ] GEOMETRY-02` — narrow geometry from the manager-attested
  key set with explicit confirmation and machine-local evidence; references
  this document.

## 6. Testing

- **Unit (GUI):** catalog set matching for exact/superset/subset/partial,
  ISO-vs-ANSI tie where no 102nd key is attested, repeated source keys,
  numpad/nav/media extra classification, the 60% `grv`-not-`esc` quirk, empty
  and "nothing fits" results never auto-selecting.
- **Fixtures:** manager JSONL fixtures for each match class and for
  capability-absent responses, following the existing fixture conventions in
  [`manager-api-status.md`](manager-api-status.md).
- **Integration:** extend TEST-04 real-keyboard acceptance — reported token set
  equals the physical board; scan + identify on the same device agree; probe
  separates an ISO board from ANSI; stale digest after hotplug invalidates the
  proposal.

## 7. Risks and open decisions

- **Key sets under-determine shape.** Mitigation is explicit, evidence-backed
  confirmation — never silent selection, never vibrance heuristics.
- **Boards omit physically-present keys** (some TKLs leave out `pause`,
  Fn-layer keys stay hidden). Detection must tolerate sticker-quality
  attestation: treat small missing/extra sets as expected, big ones as "no
  match".
- **Language/letter layout** (which letters a key types) is a different axis:
  this detects physical key presence, not the current keymap. The GUI remains
  layout-editor focused and should not claim to detect keyboard language
  from this data.
- **Identity is layout-first.** Candidates are named by layout class and trait
  (`ISO 75%`, `Split 76`), never by product or device name; see
  [`geometry-catalog.md`](geometry-catalog.md). Device conventions only appear
  in documentation, and the manager never infers a layout from a name.
- **Token vocabulary decision (§3.1)** is the main contract fork; resolve it
  with the manager before fixtures are written.
- **Probe in v1?** If disambiguation UX `device.inputscan.probe` is more work
  than value, ship ranked candidates without it and keep probe for the custom
  geometry iteration.