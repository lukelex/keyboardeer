# Live keymap validation and targeted recovery

## Decision

Every semantic edit schedules validation of the **complete keyboard draft**.
Validation is fast enough to be part of key assignment rather than a separate
review step. Key selection, palette browsing, search, and layer preview alone
do not change the candidate and do not send another request.

This is preview validation only. **Valid does not mean applied.** Profiles and
Review & Apply remain parked. The existing mapping is untouched by editing,
checking, or reverting draft assignments.

## Editing interaction

1. A click assigns the action to the selected source key immediately.
2. Remove any green validity claim immediately and show a quiet **Checking
   keymap…** indicator. Keep editing responsive and retain the selection.
3. Compile the whole draft and send
   `validation.preview({model: {device_id, behavior}})` through the manager.
   Local compiler errors may be presented before that request is possible.
4. Reconcile the result only if it still describes the current candidate and
   validation environment. Never silently apply or discard the user's edit.
5. Every correction, targeted revert, restore-original, undo/redo, or layer/
   behavior/geometry change follows the same validation path.

Coalesce rapid edits with an initial **100 ms trailing delay**. Run local
structural checks promptly. For the real manager client, allow at most one
in-flight preview per keyboard and retain only the latest pending candidate;
bound total concurrency across keyboards. A dispatched request can finish, but
its stale result cannot update current UI or recovery checkpoints. Measure real
latency before tuning the delay. A 30-second protocol maximum is not the desired
interactive response time; set a bounded client deadline and expose timeouts.

## Result hierarchy

| State | Presentation | Editing and recovery |
| --- | --- | --- |
| Unchecked / checking | Neutral, compact status beside the keyboard title. | No green state inherited from a previous revision; edits remain available. |
| Valid | Subtle checkmark and **Keymap is valid**. Secondary text: **Whole draft checked · not applied**. | No toast, modal, or interruption on each successful click. |
| Rejected | Prominent inline error panel, issue count, plain-language causes and remedies. Red/error-marked keys and layer-tab counts when the location is known. | Keep the invalid draft editable. Offer **Show key** and a targeted **Revert [key]**. |
| Blocked | Amber explanation of device availability, permissions, conflicts, dependency conditions, or validation timeout. | No invalid-key marks or suggested key rollback for an environmental problem; retry on recovery or explicitly. |
| Unavailable | Clearly say the current draft is not validated because the manager, transport, or capability is unavailable. | Keep local editing available and invalidate prior success. Recheck on reconnect/capability restoration. |

Definite local compiler errors can still be displayed while the manager is
unavailable. Passing local checks alone must never become **Keymap is valid**.
Warnings retain their severity; they do not become hard errors merely to draw
attention. If a result is valid with warnings, show **Valid · warnings** with
access to those findings.

Do not steal focus when an asynchronous error arrives. Announce the error
summary once for screen readers, use more than color to mark a key, and provide
keyboard-operable issue navigation. Success is polite, not assertive.

## Candidate identity and invalidation

Associate each job with keyboard/draft identity, a monotonically increasing
local draft revision, generated-candidate identity, manager `server_id`, and a
local validation-environment generation. Protocol request IDs correlate the
response; the draft revision is local bookkeeping, not an invented API field.

- An edit invalidates earlier responses and their recovery checkpoint updates.
- Switching device does not allow a response to paint another device's view.
- Reconnect, manager restart, availability/identity changes, capability or
  dependency changes invalidate the result even if the draft text is identical.
- A response from an old manager connection or validation generation is ignored.
- Re-entering an unchanged draft can show its still-current result; clicking a
  different key is not a reason to repeat an identical preview request.

## Explaining the cause

Every issue should identify the layer and physical source key **when known**,
the offending behavior/reference, why it is invalid, and what fixes it. Show all
affected keys, including those on other layers; selecting an issue opens that
layer and focuses its key.

Maintain a compiler source map from stable editor nodes (layer/key/behavior)
to generated behavior spans. Manager v1.1.0 may return a SHA-256 digest and a
`submitted_behavior` location only when a rejected validator range belongs to
one submitted assignment. KeyboarDeer requires the digest to match the exact
locally compiled bytes and the full range to fit exactly one local source-map
entry. Missing, unknown-scope, mismatched, or ambiguous locations remain
keymap-level issues, with no invented per-key revert. Never infer a key from
the last click or display text. Cross-key errors must name all known
dependencies rather than blaming whichever key was edited most recently.

## Revert one invalid assignment

- Keep a checkpoint of each successfully validated **whole draft**. For a
  subsequent invalid key edit, offer that key's value from the last checkpoint.
- If no validated checkpoint exists for the key/layer, a recorded pre-edit value
  may be offered, explicitly labeled **Assignment before these edits**, not
  described as valid.
- Explain the destination next to the action, e.g. **Last validated assignment:
  Escape**. This is different from restoring the keyboard's factory/original key.
- Apply a one-key inverse patch to the **current** draft. Do not replace the
  entire draft with an older snapshot or discard other invalid/valid changes.
- Check that the diagnostic revision and offending value still match. Remove or
  refresh stale controls after another edit.
- Do not resurrect deleted layers or behaviors. If the saved assignment depends
  on something now missing, explain why direct revert is unavailable and guide
  the user to the dependency instead.
- Put the revert in undo history and revalidate the whole resulting draft.
  A recovered assignment may still conflict with newer dependencies: a revert
  is a repair attempt, not a promise that the full map is now valid.

This is **draft recovery**, separate from the manager's future runtime rollback
after an activation failure.

## Prototype and acceptance

The [high-fidelity editor](design/high-fidelity-workspace.html#keymap) implements
the interaction with simulated results. Expand **Prototype tools · try validation
& recovery** below the draft footer. Inject a missing-layer action or undefined
alias on the selected key; make other edits, then revert one failing key. Result
fixtures also cover blocked devices, timeout, and rejection without a key location.
The simulation checks those fixtures, not arbitrary KMonad syntax.

Implementation acceptance includes rapid edits/out-of-order responses, switching
devices during checks, reconnect and capability changes, multiple errors across
layers, preservation of unrelated edits, repeat invalid edits to one key,
targeted revert followed by undo, missing recovery dependencies, unmapped errors,
and accessible status/issue navigation. A successful preview never alters the
running mapping, and any future apply must still revalidate at activation.
