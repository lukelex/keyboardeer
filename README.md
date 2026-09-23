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

These are design goals, not currently available features.

## Still growing its antlers

**Status: interface design and implementation planning.** This repository
contains the project identity, low-fidelity wireframes, a clickable
high-fidelity prototype, and an API integration plan. There is no installable
application yet. The selected stack is **Wails + Go + Svelte 5 + TypeScript**.

The next milestones are:

- [x] Design the choose → edit → review workflow in low- and high-fidelity mockups.
- [x] Select the GUI stack and document the manager boundary.
- [ ] Scaffold the application and connect the implemented API methods.
- [ ] Ship a capability-aware, read-only device view.
- [ ] Implement profiles, visual editing, and validation preview.
- [ ] Connect safe apply and lifecycle operations as the manager provides them.

### Explore the design and plan

- [Interface mockups and viewing instructions](docs/design/README.md)
- [Project description](docs/project-description.md)
- [Verified manager API status](docs/manager-api-status.md)
- [Integration roadmap](docs/gui-integration-roadmap.md)
- [Completion checklist](TODO.md)

The manager already implements device listing, keypress identification, and
candidate preview through API v1. Capability reporting, full snapshots,
configuration lifecycle methods, and events remain upstream dependencies at the
[reviewed revision](docs/manager-api-status.md). The prototype simulates both
current and future flows; it does not access your keyboards.

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
