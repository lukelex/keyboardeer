# KeyboarDeer artwork

`logo.svg` is the editable source for the full illustration. It is a
self-contained vector drawing with no embedded fonts, scripts, or external
images. `logo.png` is a transparent, 2400 × 2160 raster export for GitHub and
other surfaces that benefit from a predictable image preview.

`icon.svg` is the simplified app-icon source, with a rounded forest background,
bold antlers, the deer’s mischievous expression, and a minimal keyboard.
`icon.png` is its 512 × 512 export; `icon-64.png` is the small-size export.

## Direction

A balance of natural anatomy and storybook character: branching antlers,
large ears, an elongated muzzle, expressive eyes, warm shaded fur, and split
hooves. The deer faces the viewer with a mischievous smirk, its tilted head
resting in one hoof and its elbow planted on a wooden desk. The other hoof
presses a key on a mechanical keyboard shifted to the viewer's right. The
composition ends at the tabletop.

The forest medallion gives the cream and chestnut details a consistent
backdrop on both light and dark pages. The full illustration is intended for
README headers, welcome screens, and other large placements. The app icon
omits the desk, arms, and fine shading to keep the face and keyboard readable
at smaller sizes.

## Export

With the `rsvg-convert` utility from librsvg installed, run from the repository
root:

```sh
rsvg-convert --width 2400 --height 2160 assets/logo.svg --output assets/logo.png
rsvg-convert --width 512 --height 512 assets/icon.svg --output assets/icon.png
rsvg-convert --width 64 --height 64 assets/icon.svg --output assets/icon-64.png
```

Artwork is covered by the repository's MIT license.
