# Keyboard layout catalog

This document defines the expanded, layout-first geometry catalog for
KeyboarDeer. It supersedes the implicit assumption that the catalog should only
contain layouts copied from KMonad's template directory: KMonad's published
orders are the **verified seed**, and layouts we author ourselves join the same
catalog on the same evidence bar.

Companion docs:

- [Geometry verification](geometry-verification.md) — how source maps are
  verified against KMonad at the pinned commit.
- [Layout detection plan](layout-detection-plan.md) — how a physical keyboard
  is matched to catalog entries through manager-attested key sets.
- [Profile schema](profile-schema.md) — `geometry.id` / `geometry.source_keys`
  are fixed at draft creation.

## 1. The layout-first principle

The catalog's identity and naming describe the **layout**, never the product.

- "US ANSI 60%", "ISO 75%", "Ortholinear 40%", "Split 94" — not "Keychron Q1",
  "GMMK Pro", or "ErgoDox EZ".
- A real device's firmware/matrix is at most a **documented convention** that
  proves a source order is real and reproducible; it never becomes the catalog
  name, ID, or a detection input.
- This is the same rule the implementation already applies to device names: the
  GUI and the manager never map a product name to a layout, and detection (§4)
  works only from attested fact (key sets) plus layout traits.

Consequences:

- Every catalog entry gets a **brand-free ID**, a **brand-free display name**,
  and, where a device convention supplied the order, a documentation note
  citing it (e.g. *"Source order follows the documented ThinkPad X220 ISO
  matrix."*).
- The one existing exception, `kinesis-freestyle2-v1` / "Kinesis Freestyle 2",
  is renamed to the split-layout class and keeps the old ID as a legacy alias
  (§5), following the same pattern as the ANSI 60% `esc`→`grv` migration.

## 2. Taxonomy

A layout is identified by four independent axes. All four are brand-free.

### 2.1 Physical standard

- **ANSI** — straight Enter, long left shift, backslash on the home row.
- **ISO** — L-shaped Enter, split left shift, and (usually) the 102nd key.
- **JIS / JP** — ISO-like with additional Japanese keys (`yen`, `muhenkan`,
  `henkan`, …).
- Variants (WKL, HHKB) are **not** separate catalog axes: they are minor
  shapes of an existing class and arrive with custom geometry later.

### 2.2 Form-factor class

| Class | Typical key count | Defining traits |
| --- | --- | --- |
| `40` ortholinear | 48 | no number row, no F-row, ortholinear |
| `40+` ortholinear | 60 | number row, no F-row, ortholinear |
| `60` | 61–62 | no F-row, no arrows/nav |
| `65` | 68–69 | 60% + arrows + compact nav cluster |
| `75` | 83–84 | F-row + arrows + compact nav, no numpad |
| `TKL` | 87–88 | full nav cluster, no numpad |
| `96` / `1800` | ~100 | numpad + arrows, no F-row gap |
| `100` | 104–105 | numpad + nav + F-rows, full-size |
| `split` | 72–94 | two halves, thumb clusters |
| `laptop` | ~87–93 | media row + F-row, no numpad, no full nav |

### 2.3 Source basis

- **`kmonad-seed`** — the physical order is taken verbatim from a KMonad
  published template at the pinned commit. Verification = diff against that
  template (today's `catalog_test` / `geometry-verification.md`).
- **`authored`** — no published canonical order exists (ortholinear,
  ergonomic-split, our own footprint conventions). Verification = documented
  convention + compile + KMonad dry-run conformance (§7). The word "verified"
  means *documented, token-valid, and accepted by KMonad*, not "copied from
  KMonad".

### 2.4 Traits (detection + UI metadata)

Every entry carries an explicit trait record used to rank auto-detection
candidates and to keep templates distinct even in small classes:

`key_count`, `standard` (ANSI/ISO/JIS), `has_function_row`, `has_numpad`,
`has_nav_cluster`, `has_arrows`, `has_iso_key`, `has_media_keys`,
`is_split`, `is_ortholinear`, `thumb_cluster_count`.

## 3. Proposed catalog

Existing entries keep their identity; new ones use the brand-free scheme.
Counts are approximate until the exact source list is written.

> **Status:** the `kmonad-seed` additions below (`iso-60-v1`, `iso-tkl-v1`,
> `us-ansi-100-v1`, `iso-100-v1`) and the two laptop conventions
> (`laptop-iso-93-v1`, `laptop-iso-87-v1`) are **implemented and verified** in
> `internal/geometry/catalog.go`. The four seeds follow their published-template
> source orders; the laptops follow the US `defsrc` of KMonad's X220/T430
> templates, with honest key counts (93 and 87 — the X220 source is 93, not the
> 92 approximated below). All six pass the real KMonad dry-run conformance test,
> and their tokens are confirmed against the pinned `Keycode.hs` spelling set
> (§7.1). The remaining rows are proposed.

| ID (proposed) | Layout name | Standard / class | ~keys | Source basis | Notable traits |
| --- | --- | --- | --- | --- | --- |
| `us-ansi-60-v2` | US ANSI 60% | ANSI / 60 | 61 | kmonad-seed | — |
| `iso-60-v1` | ISO 60% | ISO / 60 | 62 | kmonad-seed | `iso_key` |
| `us-ansi-tkl-v1` | US ANSI TKL | ANSI / TKL | 87 | kmonad-seed | nav cluster |
| `iso-tkl-v1` | ISO TKL | ISO / TKL | 88 | kmonad-seed | `iso_key`, nav |
| `us-ansi-100-v1` | US ANSI 100% | ANSI / 100 | 104 | kmonad-seed | numpad, nav, F-rows |
| `iso-100-v1` | ISO 100% | ISO / 100 | 105 | kmonad-seed | `iso_key`, numpad |
| `split-94-v1` | Split 94 (staggered) | split / ergo | 94 | kmonad-seed | split, media keys |
| `us-ansi-65-v1` | US ANSI 65% | ANSI / 65 | 68 | authored | arrows + 4-nav |
| `iso-65-v1` | ISO 65% | ISO / 65 | 69 | authored | `iso_key`, arrows + 4-nav |
| `us-ansi-75-v1` | US ANSI 75% | ANSI / 75 | 83 | authored | F-row, arrows |
| `iso-75-v1` | ISO 75% | ISO / 75 | 84 | authored | `iso_key`, F-row |
| `us-ansi-96-v1` | US ANSI 96% | ANSI / 96 | 100 | authored | numpad, no F-row gap |
| `ortho-40-v1` | Ortholinear 40% | ortho / 40 | 48 | authored (Planck grid) | ortho, no number row |
| `ortho-60-v1` | Ortholinear 60 (Preonic grid) | ortho / 40+ | 60 | authored (Preonic grid) | ortho, number row |
| `split-76-v1` | Split 76 (ErgoDox grid) | split / ergo | 76 | authored convention | split, 10-key thumbs |
| `split-72-v1` | Split 72 (Moonlander grid) | split / ergo | 72 | authored convention | split, 12-key thumbs |
| `laptop-iso-93-v1` | ISO laptop 93 | laptop / ISO | 93 | authored convention (X220) | media row, 102nd key, no numpad |
| `laptop-iso-87-v1` | ISO laptop 87 | laptop / ISO | 87 | authored convention (T430) | media row, no 102nd key, no numpad |

Explicitly **out of scope** for this catalog (deferred to custom geometry):
Atreus, Corne/Helix (fully programmable, per-user wiring), Alice, HHKB/WKL
variants, Apple (macOS), Razer, and product-specific templates. **JIS 108** is
authorable only after JP key-token spellings are verified; it is not promised
in v1 of the catalog.

## 4. Interaction with auto-detection

- The matcher in [layout-detection-plan.md](layout-detection-plan.md) compares
  the manager-attested key set against **traits + source sets**, never against
  names. `iso_key`, `has_numpad`, `has_nav_cluster`, `has_function_row` are the
  discriminators that separate 60/65/75/TKL/96/100 and ANSI/ISO.
- The ISO-key alias problem noted in the detection plan (`lsgt` vs `102d` vs
  `nubs`) is solved in the **catalog** as a canonical trait (`has_iso_key`)
  plus a small token-alias map kept with the vocabulary table (§7.1), so it never
  leaks into UI or detection naming.
- Laptop and split entries are deliberately device-profiling-free: their source
  lists are conventions, so detection can only *propose* them when the attested
  traits match (media row, no numpad), and explicit confirmation still applies.

## 5. Renames and migration

- Keep `us-ansi-60-v2`, `us-ansi-tkl-v1` as-is.
- The verified Freestyle source order is exposed as `split-94-v1`, display
  "Split 94". `kinesis-freestyle2-v1` remains a legacy alias in `Lookup`, and
  profile-store migration 4 rewrites saved geometry IDs. The known Kinesis
  product binding lives separately in the community device catalog.
- New authored IDs are versioned (`-v1`); corrections bump the version and add
  a migration + test, exactly like the `grv` fix.

## 6. Community device templates

Verified geometries and device presentations are separate catalogs:

- `geometry.Template` is the brand-free, source-key-verified layout. Its ID is
  the identity used by profiles, compilation, and detection candidates.
- `geometry.DeviceTemplate` is a community/device-specific presentation. It
  contains brand, model, variant, description, and evidence, then references a
  verified geometry through `geometry_id`.

The built-in device catalog currently includes ThinkPad X220 ISO US, ThinkPad
T430 ISO US, and Kinesis Freestyle 2. Their model names help users find an
exact visual representation; they do not alter the underlying geometry or
become automatic detection inputs. Every device entry must resolve to an
existing geometry and include evidence.

Future community submissions may add visual overrides, case details, legends,
knobs, and variant-specific artwork, but must preserve the same binding rule:
they cannot introduce an unverified source-key order. A device-template picker
should show the referenced geometry and evidence before creating a profile.

## 7. Enabling work (before/with the catalog)

1. **Verified KMonad token vocabulary** — ✅ implemented as
   `internal/geometry/kmonad_vocabulary.go`, a table generated from KMonad's
   `Keycode.hs` at the pinned commit (not from the template directory): every
   `Key*` constructor and its alias spellings, `Btn*`/`Missing*`/`VK*` excluded.
   The compiler's `knownKeys` gate now is this vocabulary, and
   `internal/geometry/kmonad_vocabulary_test.go` pins the source counts and
   asserts every catalog source token and advertised output key is a verified
   spelling. This is what makes arbitrary authored layouts safe.
2. **Parametric position builder** — layout definitions become a compact,
   brand-free spec (rows, widths via the existing `standardWidth` heuristic,
   grid vs. staggered). The renderer derives `Row/Width/GapBefore`; the
   "exact positional agreement between drawn keys and `source_keys`"
   invariant holds by construction instead of by hand-copy.
3. **Conformance tests** — every catalog entry (seed or authored):
   - diff against the published template for `kmonad-seed` entries;
   - compile a generated `(defsrc …)(deflayer base …)` and run KMonad
     dry-run via the pinned KMonad binary — the `COMPILE-02` precedent
     (exercised for every selectable geometry, both laptop rows included);
   - token-validity check against the vocabulary table;
   - complete key IDs/labels/tokens, unique IDs, nondecreasing rows, exact
     positional agreement (existing `catalog_test` bar extended).
4. **Trait metadata** on `Template` and a traits test so detection candidates
   stay distinguishable per class.

## 8. Tracking

- [x] **GEOMETRY-03 — layout-first catalog expansion (seed + foundations):**
  the four seed additions (ISO 60/TKL, 100% ANSI/ISO), the laptop conventions
  (`laptop-iso-93-v1`, `laptop-iso-87-v1`), and the verified KMonad token
  vocabulary backed by the compiler gate.
- [ ] **GEOMETRY-03 — continuation (catalog expansion):**
  - authored 65/75/96 entries (`us-ansi-65-v1`, `iso-65-v1`, `us-ansi-75-v1`,
    `iso-75-v1`, `us-ansi-96-v1`);
  - ortholinear entries (`ortho-40-v1`, `ortho-60-v1`);
  - split-ergo entries (`split-76-v1`, `split-72-v1`);
  - parametric position builder (§7.2) — preferred before hand-writing the
    grid/ergo rows;
  - completed `split-94-v1` rename + legacy alias + store migration (§6).
- Detection work remains tracked under **GEOMETRY-02** / **MGR-06**.
