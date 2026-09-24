# Profile schema

KeyboarDeer profiles are the source of truth for keyboard drafts. Generated
KMonad behavior is derived from them and is never parsed back. This document
describes store version **2**, defined in `internal/profile/profile.go`.

## Storage

- Location: `$XDG_CONFIG_HOME/keyboardeer/profiles.json` (Go's
  `os.UserConfigDir`), owner-only (`0600`) in an owner-only directory.
- Every write goes to a private temporary file that is synced and renamed over
  the store, then the directory is synced. A crash leaves the previous or the
  new complete file. An orphaned `.profiles-*` temporary file is ignored.
- Each profile carries a `draft_revision`. A write must name the current
  revision; a stale write is rejected rather than overwriting newer edits.

## Document

```json
{
  "version": 2,
  "profiles": [Profile],
  "selected": { "<device_id>": "<profile_id>" }
}
```

A keyboard may have several profiles. `selected` records which one is opened
for each keyboard and must point at a profile for that same device. Creating or
duplicating a profile selects it; deleting the selected profile selects the
keyboard's earliest remaining profile.

A manager configuration is linked to at most one profile. Applying a different
profile of the same keyboard updates that keyboard's existing configuration and
moves the link, rather than creating a second configuration for the device.

| Field | Meaning |
| --- | --- |
| `id` | Local opaque profile ID (`profile_<hex>`). Never a manager ID. |
| `name` | Display name, 1–80 characters. |
| `device_id` | Opaque manager device ID the profile is for. Fixed at creation. |
| `manager_configuration_id` | Opaque manager configuration linked by Apply. Written only by the apply workflow. |
| `apply_pending` | Set while an Apply outcome is unknown; blocks editing and another Apply. |
| `draft_revision` | Positive, incremented by every draft edit. |
| `geometry.id` | Verified layout ID. Fixed at creation. |
| `geometry.source_keys` | KMonad source keys in physical order. Repeated codes are shared physical keys. Fixed at creation. |
| `layers` | Ordered layers. The first must be `base`. IDs match `^[A-Za-z][A-Za-z0-9-]*$`; names are unique, 1–80 characters. |
| `assignments` | At most one behavior per `(layer_id, source_key)`. Unassigned Base keys send their own source key; unassigned overlay keys pass through. |
| `aliases` | Named reusable behaviors. Names use the identifier form and are distinct from macro names. |
| `macros` | Named ordered key presses (at least one step). |
| `settings.version` | Compiler settings version; currently `1`. |
| `created_at`, `updated_at` | UTC timestamps maintained by the store. |

### Behaviors

| `kind` | Fields | Notes |
| --- | --- | --- |
| `key` | `key` | A key name from a verified layout. |
| `transparent` | — | Overlay layers only. |
| `disabled` | — | The key does nothing. |
| `hold_layer` | `target` | Layer active while held. |
| `switch_layer` | `target` | Layer stays active until switched again. |
| `tap_hold` | `tap`, `hold`, `timeout_ms` | Timeout 1–10000 ms. Tap: key, alias, macro, switch layer, or disabled. Hold: key, hold layer, or alias. |
| `alias` | `target` | References an alias. |
| `macro` | `target` | References a macro. Macro steps are `key` behaviors only. |

References must resolve, and alias/macro references must not form a cycle.

## Versioning and migration

- `version` identifies the whole document. A missing version is version 0.
  Version 1 added draft revisions; version 2 added `selected`, choosing the
  linked profile (or else the earliest) for each keyboard.
- On load, older versions are upgraded one step at a time by the functions in
  `migrations` (`internal/profile/store.go`). Before the upgraded store is
  written, the exact original bytes are kept as `profiles.json.v<N>-backup`.
- A store from a **newer** KeyboarDeer is refused and never reset, so a
  downgrade cannot destroy data.
- A store that is unreadable or fails validation is reported as damaged. The
  UI can then move it aside as `profiles.json.corrupt-<timestamp>` and start
  an empty list; running mappings are unaffected.

Adding a field with a safe zero value does not require a new version. Changing
the meaning of a field, or making a new field required, does: add a migration
step and a test that loads the previous format.
