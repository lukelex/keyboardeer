<div align="center">

<img src="assets/logo.png" alt="A smirking storybook stag rests its head in one hoof while pressing a key with the other, at a wooden desk." width="640" />

# KeyboarDeer

### A little wild. A little wired.

**A visual configurator for KMonad.**

Your keyboard. Your habits. Your natural habitat.

[The idea](#give-your-keyboard-a-new-instinct) · [Project status](#still-growing-its-antlers) · [Artwork](#meet-the-deer) · [Get involved](#pull-up-a-chair)

</div>

---

## Give your keyboard a new instinct

The right layout makes a keyboard feel like an extension of your hands.
Getting there should feel just as natural.

KeyboarDeer is a planned graphical companion for
[KMonad](https://github.com/kmonad/kmonad) and
[KMonad Device Manager](https://github.com/lukelex/kmonad-device-manager).
The goal: make keyboard configuration something you can see, understand,
and shape—one key at a time.

### What we're working toward

- **See your layout.** A visual home for key mappings and layers.
- **Know your keyboard.** Clear device selection and per-keyboard configuration.
- **Make changes with confidence.** Validation and useful feedback before applying a mapping.
- **Close the window. Keep typing.** The device manager remains an independent
  service, supervising your mappings even when the GUI is closed.

These describe the product direction; implemented scope and remaining release
work are summarized below.

## Still growing its antlers

**Status: Linux desktop application implemented; pre-v1 release hardening.**
KeyboarDeer is a **Wails + Go + Svelte 5 + TypeScript** desktop app and a client
of [KMonad Device Manager](https://github.com/lukelex/kmonad-device-manager).
Linux is the first release target. Development builds target manager v1.2.0 or
later, and enable features according to the capabilities negotiated with the
running service.

Implemented application workflows include:

- Live keyboard inventory, runtime state, and keyboard identification.
- Persistent per-keyboard profiles, verified keyboard geometries, visual key
  and layer editing, and undo/redo.
- Automatic whole-draft validation, actionable diagnostics, and targeted
  recovery for invalid assignments.
- Explicit review and apply, managed configuration lifecycle, and recovery of
  operations across reconnects.
- Portable profile import/export, manager-rendered `.kbd` export, and
  read-only viewing or explicit adoption of supported external configurations.
- Linux build and install packaging with CI release artifacts.

The remaining Linux v1 release gates are real-keyboard acceptance (including
hotplug, multi-keyboard isolation, and continued manager supervision when the
GUI closes), a clean-install end-to-end acceptance run, and first-time-user
design review. After Linux v1, the roadmap expands the verified geometry catalog
and advanced behaviors, then adds macOS and Windows support as manager backends
and transports become available. Arbitrary external `.kbd` files are not
visually imported.

### Run the desktop shell

On Linux with the [documented prerequisites](docs/development.md), launch the desktop app with:

```sh
./scripts/desktop.sh
```

For live device workflows, run KMonad Device Manager v1.2.0 or later. When the
manager is unavailable or does not advertise a required capability, the app
explains the unavailable state and keeps the affected actions disabled. The
browser-based Vite preview has no desktop bindings and does not simulate a
manager connection.

### Explore the design and development plan

The standalone HTML mockups are interactive design prototypes; they simulate
state and operations rather than connecting to the manager. The desktop app
contains the implemented workflows described above.

- [Design prototypes and viewing instructions](docs/design/README.md)
- [High-fidelity workspace prototype](docs/design/high-fidelity-workspace.html)
- [Project description](docs/project-description.md)
- [Verified manager API status](docs/manager-api-status.md)
- [Integration roadmap](docs/gui-integration-roadmap.md)
- [Implementation and release checklist](TODO.md)
- [Live validation and per-key recovery](docs/live-validation.md)
- [Development setup and commands](docs/development.md)

The guiding principle is simple: **the GUI is a companion; the service keeps
the keyboards running.**

## Meet the deer

One raised eyebrow. A proper set of antlers. One very deliberate keypress.

The KeyboarDeer mascot mixes natural deer features with a warm, illustrated
character: a long muzzle, branching antlers, soft fur shading, and a
mischievous smirk. Head propped in one hoof, the deer presses a key with the
other. A wooden tabletop and a mechanical keyboard bring the woodland and
the workstation together.

The name is written **KeyboarDeer**—the capital **D** helps the pun peek out.

| | Color | Hex |
| --- | --- | --- |
| Forest | Deep green | `#142e29` |
| Chestnut | Warm coat | `#b97b48` |
| Cream | Soft highlights | `#fff0d1` |
| Sage | Keyboard accents | `#557e6e` |
| Antler | Muted gold | `#c49c69` |

The [editable SVG](assets/logo.svg) is the source artwork. The
[high-resolution PNG](assets/logo.png) is used above for consistent rendering.
See [the artwork notes](assets/README.md) for export instructions.

### Small icon, same attitude

<img src="assets/icon.png" alt="Simplified KeyboarDeer app icon: a smirking deer above a keyboard on forest green." width="128" />

The [app icon](assets/icon.svg) keeps the antlers, crooked grin, and keyboard
in a compact silhouette for smaller placements.

## Pull up a chair

Have an opinion about visual layout editors, layers, accessibility, or what
makes a keyboard feel right? [Open an issue](https://github.com/lukelex/keyboardeer/issues).
Concrete workflows and sketches are especially welcome at this stage.

For the service that actually supervises KMonad processes, visit
[KMonad Device Manager](https://github.com/lukelex/kmonad-device-manager).

## License

[MIT](LICENSE), including the original artwork in this repository.

---

<div align="center">
<sub>Made for creatures of habit. And people who remap them.</sub>
</div>
