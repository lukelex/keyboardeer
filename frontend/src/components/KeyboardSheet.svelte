<script lang="ts">
  import type { Keymap } from "../domain/keymap";
  import type { GeometryTemplate } from "../platform/desktop";

  // A read-only keyboard for one layer, for overviews and printing.
  interface Props {
    geometry: GeometryTemplate;
    keymap: Keymap;
    layerID: string;
    /** Width of one standard key, in pixels. */
    unit?: number;
  }
  let { geometry, keymap, layerID, unit = 34 }: Props = $props();
  const rows = $derived(
    [...new Set(geometry.keys.map((key) => key.row))].sort((left, right) => left - right),
  );
</script>

<div class="keyboard-sheet" role="img" aria-label={`${keymap.layerName(layerID)} layer`}>
  {#each rows as row}
    <div class="keyboard-sheet-row">
      {#each geometry.keys.filter((key) => key.row === row) as key (key.id)}
        {@const legend = keymap.capLegend(layerID, key.source_key, {
          readable: true,
        })}
        <div
          class={[
            "sheet-key",
            keymap.isRemapped(layerID, key.source_key) && "remapped",
            keymap.fallsThrough(layerID, key.source_key) && "fallthrough",
          ]}
          style={`width: ${key.width * unit - 3}px; margin-left: ${(key.gap_before ?? 0) * unit}px`}
          title={`${key.label}: ${keymap.describe(keymap.behaviorAt(layerID, key.source_key), key.source_key, layerID)}`}
        >
          <span>{key.label}</span>
          <strong>{legend.text}</strong>
          {#if legend.hold}<small>↓ {legend.hold}</small>{/if}
        </div>
      {/each}
    </div>
  {/each}
</div>
