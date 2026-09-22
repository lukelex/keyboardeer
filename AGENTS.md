# KeyboarDeer

## Current state

- This is a concept/branding repository, not an implemented application. There
  are no package manifests, app entrypoints, build/test scripts, or CI workflows.
- Read `docs/project-description.md` before implementation. It specifies
  Wails + Go + Svelte 5 + TypeScript; the README still says the stack is
  undecided. No executable configuration establishes versions or tooling yet.

## Planned architecture

- KeyboarDeer is the editor; the separate `kmonad-device-manager` service owns
  device discovery/identification, platform input access, validation, apply,
  KMonad supervision, recovery, and runtime diagnostics. The service must keep
  running mappings with the GUI closed.
- Keep the GUI's Go backend thin: manager communication, profile persistence,
  config compilation, import/export, and desktop integration. Do not duplicate
  device access or process supervision, or choose device-specific `defcfg`
  representation in the GUI.
- GUI profiles are the source of truth; `.kbd` files are generated artifacts.
  The intended flow is profile → compile → manager validation → manager apply,
  not parsing generated `.kbd` files back into editor state.
- External `.kbd` files remain manager-supervised. Full visual import of
  arbitrary KMonad configurations is explicitly outside the initial scope.

## Artwork

- `assets/logo.svg` is the editable source; `assets/logo.png` is its committed
  2400 × 2160 export used by the README. Regenerate the PNG after SVG changes.
  From the repository root, with librsvg's `rsvg-convert` installed:

  ```sh
  rsvg-convert --width 2400 --height 2160 assets/logo.svg --output assets/logo.png
  ```

- Keep the SVG self-contained (no external images, fonts, or scripts).
  Preserve the natural-anatomy/storybook balance and front-facing deer typing
  pose; `assets/README.md` records the composition and export details.
