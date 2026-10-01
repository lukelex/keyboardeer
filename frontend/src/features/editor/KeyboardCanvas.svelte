<script lang="ts">
  import Button from "../../components/Button.svelte";
  import { useApp } from "../../state/context";

  // The physical keyboard for the selected layer. Each cap shows its label
  // and a short legend for what it does; the tooltip has the full sentence.
  let { flashingKey = "" }: { flashingKey?: string } = $props();
  const { editor } = useApp();
  const geometry = $derived(editor.geometry!);
  const keymap = $derived(editor.keymap!);
</script>

<div
  class="keyboard-editor"
  id="keyboard-layer-panel"
  role="tabpanel"
  aria-labelledby={`layer-tab-${editor.layerID}`}
  aria-label={geometry.name}
>
  {#each editor.rows as row}
    <div class="keyboard-row">
      {#each geometry.keys.filter((key) => key.row === row) as key (key.id)}
        {@const behavior = keymap.behaviorAt(editor.layerID, key.source_key)}
        {@const legend = keymap.capLegend(editor.layerID, key.source_key)}
        {@const change = editor.showChanges
          ? editor.changeAt(editor.layerID, key.source_key)
          : undefined}
        <Button
          variant="key"
          class={[
            keymap.fallsThrough(editor.layerID, key.source_key) && "fallthrough-key",
            keymap.isRemapped(editor.layerID, key.source_key) && "remapped-key",
            change && "changed-key",
            behavior?.kind === "disabled" && "disabled-key",
            editor.selectedKeys.includes(key.source_key) && "selected-key",
            editor.isInvalidKey(key.source_key) && "invalid-key",
            flashingKey === key.source_key && "flashing-key",
          ]}
          style={`width: ${key.width * 42}px; margin-left: ${(key.gap_before ?? 0) * 42}px`}
          data-issue-key
          data-layer-id={editor.layerID}
          data-source-key={key.source_key}
          data-change={change}
          title={behavior?.kind === "disabled"
            ? `Disabled on ${editor.activeLayer?.name ?? "current"} layer: this key sends no input and blocks lower layers.`
            : `${key.label}: ${keymap.describe(behavior, key.source_key, editor.layerID)}`}
          onclick={(event) =>
            editor.toggleKey(
              key.source_key,
              event.shiftKey || event.ctrlKey || event.metaKey,
            )}
          aria-pressed={editor.selectedKeys.includes(key.source_key)}
        >
          <strong>{key.label}</strong><small
            >{legend.text}{#if legend.hold}<span class="cap-hold"
                ><span aria-hidden="true">↓</span> {legend.hold}</span
              >{/if}</small
          >
        </Button>
      {/each}
    </div>
  {/each}
</div>
