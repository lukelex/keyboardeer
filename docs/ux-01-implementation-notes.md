# UX-01 — Accessibility and keyboard usability

**Status:** Complete. See the [checklist](../TODO.md).

UX-01 required keyboard navigation, useful accessible names, focus
restoration, screen-reader announcements, contrast, scalable type, 200% zoom,
small-window behavior, and reduced motion. This page records what shipped and
how it is verified.

## Implementation

### Keyboard navigation

- Layer and palette-category tabs implement the WAI-ARIA tabs pattern: a real
  `role="tablist"` container with `tabindex="-1"`, roving `tabindex` on the
  tabs (`0` on the active tab, `-1` elsewhere), and a shared
  `handleTabListKeydown` action so `ArrowLeft`/`ArrowRight`/`ArrowUp`/
  `ArrowDown` move focus and activate the next/previous tab (wrapping at the
  ends). Arrow *Up*/*Down* are accepted as horizontal equivalents for
  right-to-left/top-to-bottom preferences.
- Dialog keyboard support: `manageDialog` moves initial focus to the first
  focusable element (or `[autofocus]`), traps `Tab`/`Shift+Tab` inside the
  dialog, and every modal closes on `Escape` via the window-level
  `handleGlobalKeydown` handler.

### Accessible names and announcements

- Real `role="tabpanel"` wiring: each tab sets `aria-controls` to the panel id
  and each panel sets `aria-labelledby` back to the active tab. Layer panels
  are `keyboard-layer-panel`, palette panels `palette-category-panel`.
- Every dialog is `aria-modal="true"` with a labelled heading
  (`aria-labelledby`), and its close control has an explicit `aria-label`.
- Palette keys carry `aria-label="Assign …"` plus a descriptive `title`.
- The selected-key context in the palette is a live region
  (`aria-live="polite"` + `aria-atomic="true"`) announcing the selected key
  and active layer; inline feedback uses `role="status"` and errors
  `role="alert"`.
- All interactive controls keep visible focus: `:focus-visible` outlines for
  buttons and for links/inputs/selects/textarea/tab roles.

### Focus restoration

- `manageDialog` records the opener (the element with focus when the dialog
  mounts), inerts the app background, and restores focus to the opener when
  the dialog closes — including when it is closed with `Escape`.

### Contrast, type, zoom, and small windows

- Text contrast is held to WCAG AA (≥ 4.5:1) for editor/palette secondary
  buttons and small labels; the Playwright suite asserts the computed ratios.
- Typography and spacing use fluid `clamp()` values so type scales with the
  window, and the layout compacts at `max-width: 680px`.
- Small windows (the CSS-pixel equivalent of 200% zoom at a 1280-wide window)
  switch to the compact palette (`viewport-height ≤ 720`): the palette becomes
  a horizontal strip whose key rows and category tabs scroll within their own
  boxes, and the editor heading wraps instead of clipping. The editor grid now
  uses `grid-template-columns: minmax(0, 1fr)` with `min-width: 0` on the
  scroll region and palette so trailing controls (for example the Apply
  button) stay fully visible instead of being cut off at narrow widths.

### Reduced motion

- A universal `@media (prefers-reduced-motion: reduce)` override collapses
  animation and transition durations and forces instant scrolling; the
  editor's key flash is asserted to run at near-zero duration under reduced
  motion.

## Verification

- Playwright: `supports keyboard navigation, dialog focus trapping, and focus
  restoration` (`frontend/tests/workspace.spec.ts`) covers tablist arrow
  navigation and wrap-around, `aria-selected`/`tabindex` roving, tabpanel
  wiring, the aria-live selected-key context, dialog `aria-modal`, initial
  focus, `Tab`/`Shift+Tab` trapping, inert background (`inert` on header and
  main), `Escape` closing with focus restored to the opener, reduced-motion
  flash duration, and small-window layout (compact palette class, palette
  width, no document-level horizontal overflow, overflow-scrolled key rows and
  categories, and the Apply control fully inside the viewport).
- The contrast assertions (≥ 4.5:1) live in the editor test in
  `frontend/tests/workspace.spec.ts`.