<script lang="ts">
  import { rovingTabs } from "../../actions/tabs";
  import Button from "../../components/Button.svelte";
  import { baseLayerID } from "../../domain/keymap";
  import { useApp } from "../../state/context";

  // Layer tabs, which say how each layer is entered, and the complex actions
  // for the selected key.
  let { helpOpen = $bindable(false) }: { helpOpen?: boolean } = $props();
  const { editor, library } = useApp();
  const keymap = $derived(editor.keymap!);
  const noKey = $derived(!editor.sourceKey || library.busy);

  function entryDescription(layerID: string) {
    if (layerID === baseLayerID) return "Active by default";
    return keymap.isReachable(layerID)
      ? `Entered ${keymap.entrySummary(layerID)}`
      : "No entry key yet";
  }
</script>

<div class="palette-toolbar">
  <div
    class="layer-tabs"
    role="tablist"
    aria-label="Keymap layers"
    tabindex="-1"
    use:rovingTabs
  >
    {#each keymap.layers as layer (layer.id)}
      {@const reachable = keymap.isReachable(layer.id)}
      <Button
        variant="secondary"
        class={[
          "layer-tab",
          editor.layerID === layer.id && "active",
          !reachable && "unreachable",
          editor.showChanges && editor.layerHasChanges(layer.id) && "has-changes",
        ]}
        role="tab"
        id={`layer-tab-${layer.id}`}
        aria-controls="keyboard-layer-panel"
        aria-selected={editor.layerID === layer.id}
        tabindex={editor.layerID === layer.id ? 0 : -1}
        onclick={() => editor.selectLayer(layer.id)}
        aria-describedby={`layer-tab-${layer.id}-entry`}
        title={layer.id === baseLayerID
          ? "Base layer: active by default"
          : reachable
            ? `${layer.name} layer, entered ${keymap.entrySummary(layer.id)}`
            : `${layer.name} has no entry key yet. Assign a layer action to reach it.`}
        ><span>{layer.name}</span>{#if layer.id !== baseLayerID}<small
            aria-hidden="true"
            class={[!reachable && "layer-tab-warning"]}
            >{reachable ? keymap.entrySummary(layer.id) : "⚠ no entry key"}</small
          >{/if}</Button
      >
    {/each}
  </div>
  <div class="visually-hidden">
    {#each keymap.layers as layer (layer.id)}
      <span id={`layer-tab-${layer.id}-entry`}>{entryDescription(layer.id)}</span>
    {/each}
  </div>
  <Button
    variant="secondary"
    class="layer-tab"
    onclick={() => editor.openDialog("layers")}
    title="Manage layers">Manage</Button
  >
  <Button
    variant="secondary"
    class="layer-tab layer-help-toggle"
    type="button"
    aria-expanded={helpOpen}
    aria-controls="layer-help"
    aria-label="How layers work"
    title="How layers work"
    onclick={() => (helpOpen = !helpOpen)}>?</Button
  >
  <div class="complex-actions">
    <Button variant="secondary" onclick={() => editor.openDialog("tap_hold")} disabled={noKey}
      >Tap &amp; hold</Button
    >
    <Button variant="secondary" onclick={() => editor.openDialog("layer")} disabled={noKey}
      >Layer action</Button
    >
    <Button variant="secondary" onclick={() => editor.openDialog("alias")} disabled={noKey}
      >Alias</Button
    >
    <Button variant="secondary" onclick={() => editor.openDialog("macro")} disabled={noKey}
      >Macro</Button
    >
    {#each Object.keys(keymap.profile.aliases ?? {}).sort() as name}
      <Button
        variant="secondary"
        class="declaration-action"
        onclick={() => editor.assign({ kind: "alias", target: name })}
        disabled={noKey}
        title={`Assign alias ${name}`}>@{name}</Button
      >
    {/each}
    {#each Object.keys(keymap.profile.macros ?? {}).sort() as name}
      <Button
        variant="secondary"
        class="declaration-action"
        onclick={() => editor.assign({ kind: "macro", target: name })}
        disabled={noKey}
        title={`Assign macro ${name}`}>#{name}</Button
      >
    {/each}
  </div>
</div>
