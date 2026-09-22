# KeyboarDeer artwork

`logo.svg` is the editable source for the full illustration. It is a
self-contained vector drawing with no embedded fonts, scripts, or external
images. `logo.png` is a transparent, 2400 × 2160 raster export for GitHub and
other surfaces that benefit from a predictable image preview.

## Direction

A balance of natural anatomy and storybook character: branching antlers,
large ears, an elongated muzzle, expressive eyes, warm shaded fur, and split
hooves resting on a mechanical keyboard. The deer faces the viewer and sits
behind a wooden desk. The composition ends at the tabletop.

The forest medallion gives the cream and chestnut details a consistent
backdrop on both light and dark pages. The full illustration is intended for
README headers, welcome screens, and other large placements. A separate,
simplified application icon should be designed for small sizes.

## Export

With the `rsvg-convert` utility from librsvg installed, run from the repository
root:

```sh
rsvg-convert --width 2400 --height 2160 assets/logo.svg --output assets/logo.png
```

Artwork is covered by the repository's MIT license.
