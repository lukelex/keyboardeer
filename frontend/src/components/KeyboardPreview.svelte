<script lang="ts">
  import type { GeometryTemplate } from "../platform/desktop";

  // A small, decorative outline of a verified physical layout, drawn with the
  // same widths and gaps as the editor (one unit per standard key).
  let { geometry }: { geometry: GeometryTemplate } = $props();

  const unit = 10;
  const gap = 1.5;
  const rows = $derived(
    [...new Set(geometry.keys.map((key) => key.row))].sort(
      (left, right) => left - right,
    ),
  );
  const rects = $derived(
    rows.flatMap((row, rowIndex) => {
      let x = 0;
      return geometry.keys
        .filter((key) => key.row === row)
        .map((key) => {
          x += (key.gap_before ?? 0) * unit;
          const rect = { x, y: rowIndex * unit, width: key.width * unit - gap };
          x += key.width * unit;
          return rect;
        });
    }),
  );
  const width = $derived(
    Math.max(...rects.map((rect) => rect.x + rect.width), unit),
  );
  const height = $derived(rows.length * unit);
</script>

<svg
  class="keyboard-preview"
  viewBox={`-2 -2 ${width + 4} ${height + 4}`}
  aria-hidden="true"
>
  {#each rects as rect}
    <rect
      x={rect.x}
      y={rect.y}
      width={rect.width}
      height={unit - gap}
      rx="1.6"
    />
  {/each}
</svg>
