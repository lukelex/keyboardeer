# MGR-06 token namespace decision — `kmonad-v1`

Status: **proposed, awaiting GUI confirmation.** This note resolves the
"blocking decision" in `docs/layout-detection-plan.md` §3.1 (token vocabulary)
and records the exact contract between the manager's `device.inputscan.get`
scan and the GUI's geometry catalog.

Owner: `kmonad-device-manager` (manager side implemented). Confirmer:
KeyboarDeer GUI (this repository).

## Decision

`token_namespace: "kmonad-v1"` is the **KMonad keycode identity**, and the
manager emits one canonical spelling per key: KMonad's constructor-short name
for named keys, and the conventional symbol alias for punctuation (`-`, `=`,
`[`, `]`, `;`, `'`, `,`, `.`, `/`, `\`). Both sides compare keys by KMonad
constructor, not by raw spelling.

Rationale:

- A namespace needs exactly **one token per key**. KMonad itself accepts many
  spellings per key, and even its own published templates disagree (`lsgt` in
  `iso_60.kbd`, `102d` in `iso_tkl.kbd` / `iso_100.kbd` for the same key). Raw
  spelling cannot be the shared identity.
- The GUI already ships the translation table
  (`internal/geometry/kmonad_vocabulary.go`, `kmonadKeycodeTokens`), so
  normalizing to constructor is already within reach on the GUI side.
- It keeps all platform translation manager-side: the manager never emits a
  raw evdev `KEY_*` name, and the GUI never parses evdev.

## Ground truth

KMonad `src/KMonad/Keyboard/Keycode.hs` at the pinned commit
`30b9705fb56059483969624d58cad077d5c62300`:

- `keyNames = nameKC tshow kcAll <> nameKC (T.drop 3 . tshow) kcNotMissing <> aliases`.
- So every constructor has, at minimum, its full name, its lowercased full
  name, its `Key`-stripped name, and its lowercased `Key`-stripped name, plus
  the `aliases` list.

The manager's `kmonad-v1` vocabulary is the `Key`-stripped lowercased
constructor name for named keys, and the symbol alias for punctuation.

## Divergences to reconcile

Manager (canonical `kmonad-v1`) vs. GUI catalog source tokens vs. KMonad:

| Keycode | Manager emits | GUI catalog uses | KMonad also accepts |
|---|---|---|---|
| `Key102nd` | `102nd` | `lsgt`, `102d` | `102d`, `lsgt`, `nubs` |
| `KeyKpEnter` | `kpenter` | `kprt` | `kprt` |
| `KeyKpSlash` | `kpslash` | `kp/` | `kp/` |
| `KeyKpAsterisk` | `kpasterisk` | `kp*` | `kp*` |
| `KeyKpMinus` | `kpminus` | `kp-` | `kp-` |
| `KeyKpPlus` | `kpplus` | `kp+` | `kp+` |
| `KeyKpDot` | `kpdot` | `kp.` | `kp.` |
| `KeyNumLock` | `numlock` | `nlck` | `nlck` |
| `KeyScrollLock` | `scrolllock` | `slck` | `scrlck`, `slck` |
| `KeySysRq` | `sysrq` | `ssrq` | `ssrq`, `sys` |
| `KeyCompose` | `compose` | `cmp` | `comp`, `cmps`, `cmp`, `app`, `application` |

All rows above are valid KMonad tokens; they differ only in spelling. The GUI
catalog's `cmp` is `KeyCompose`, which is why it labels the key "Menu": many
boards send `KEY_COMPOSE` for the menu key, not `KEY_MENU`. Normalizing to
constructor resolves this cleanly; raw spelling does not.

The manager also emits `\` (`KeyBackslash`) and `]` (`KeyRightBrace`), both
valid KMonad aliases (`bksl`/`\`, `rbrc`/`]`).

## GUI-side gaps found while reconciling

The generated `internal/geometry/kmonad_vocabulary.go` is **incomplete** for a
few constructors, so normalizing through it today would reject valid tokens:

- `KeyRightBrace` has an empty alias list; KMonad defines `rbrc`, `]`.
- `KeyBackslash` lists only `nonuspound`; KMonad also defines `bksl`, `\`.
- `KeyCompose` lists only `app`, `application`; KMonad also defines `comp`,
  `cmps`, `cmp`.

These look like the generator keeping only one alias block per constructor
(`KeyBackslash` and `KeyCompose` each appear twice in `aliases`) and/or losing
the `]` alias. The generator itself is not in this tree, so it needs to be
re-run/fixed where it lives. Until then, the catalog's own `cmp` source token
would fail `KnownKMonadKeys()`.

Also note the inherited KMonad inconsistency: `internal/geometry/catalog.go`
uses `lsgt` in `ISO60US` and `102d` in `ISOTKLUS`/`ISO100US` for the same key.

## What each side must do

Manager (done, pending this confirmation):

- Emit `token_namespace: "kmonad-v1"` and constructor-short/symbol tokens.
- Fixed one invalid token while reconciling: `kpen` → `kpenter`
  (`kpen` is not in KMonad's `keyNames` at all).

GUI (required before any detection fixture is written):

1. Normalize both catalog `source_key`s and scan `keys` through a corrected
   spelling→constructor table before set comparison.
2. Fix the incomplete alias table above (`]`, `\`, `cmp`/`comp`/`cmps`).
3. Decide whether to keep `lsgt`/`102d` mixed in templates or normalize them to
   one display spelling (either is fine once comparison is by constructor).

## Decision requested

Confirm that `kmonad-v1` means **KMonad constructor identity**, with the manager
emitting constructor-short/symbol spellings and the GUI normalizing through a
corrected translation table. If the GUI would rather have literal string
equality, say so and the manager will instead emit the GUI catalog's exact
spellings (the table above is the complete change set).
