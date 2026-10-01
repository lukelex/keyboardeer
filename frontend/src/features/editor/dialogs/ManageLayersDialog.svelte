<script lang="ts">
  import Button from "../../../components/Button.svelte";
  import { baseLayerID } from "../../../domain/keymap";
  import { count } from "../../../domain/text";
  import { useApp } from "../../../state/context";
  import ComplexActionDialog from "./ComplexActionDialog.svelte";
  import NewLayerField from "./NewLayerField.svelte";

  const { editor, library } = useApp();
  const keymap = $derived(editor.keymap!);
  let rename = $state(editor.activeLayer?.name ?? "");
  let error = $state("");

  const index = $derived(keymap.layerIndex(editor.layerID));
  const own = $derived(keymap.assignmentCount(editor.layerID));
  const references = $derived(keymap.entryCount(editor.layerID));
  const isBase = $derived(editor.layerID === baseLayerID);
  const duplicateName = $derived(
    keymap.layers.some(
      (layer) => layer.id !== editor.layerID && layer.name === rename.trim(),
    ),
  );

  async function submitRename(event: SubmitEvent) {
    event.preventDefault();
    const result = await editor.renameLayer(rename);
    error = result.ok ? "" : result.error;
  }

  async function remove() {
    const result = await editor.deleteLayer();
    if (result.ok) rename = "";
    else error = result.error;
  }
</script>

<ComplexActionDialog title="Manage layers" {error}>
  <p class="dialog-intro">
    Layers without an entry action cannot be reached from the keyboard. Add a
    Hold layer or Switch layer action before applying this draft.
  </p>
  <NewLayerField
    id="manage-new-layer-name"
    label="Add a layer"
    hint="The new layer is selected automatically; add a layer action to make it reachable."
    onerror={(message) => (error = message)}
  />
  <div class="layer-manager-list" aria-label="Layers">
    {#each keymap.layers as layer, position (layer.id)}
      <Button
        variant="plain"
        class={[
          editor.layerID === layer.id && "active",
          !keymap.isReachable(layer.id) && "unreachable",
        ]}
        onclick={() => {
          editor.selectLayer(layer.id);
          rename = layer.name;
        }}
        >{layer.name}<small
          >{keymap.isReachable(layer.id) ? "Reachable" : "No entry action"}</small
        ></Button
      >
      {#if position === 0}<span class="layer-manager-base">Required</span>{/if}
    {/each}
  </div>
  <form class="behavior-form" onsubmit={submitRename}>
    <label for="rename-layer">Rename selected layer</label>
    <input id="rename-layer" bind:value={rename} maxlength="40" required />
    <div class="layer-manager-actions">
      <Button
        variant="secondary"
        type="button"
        disabled={index <= 1 || library.busy}
        title={index <= 1
          ? "Base is fixed at the beginning of the layer order."
          : "Move this layer earlier in the order."}
        onclick={() => editor.moveLayer(-1)}>Move earlier</Button
      >
      <Button
        variant="secondary"
        type="button"
        disabled={index < 1 || index >= keymap.layers.length - 1 || library.busy}
        title={index >= keymap.layers.length - 1
          ? "This layer is already last."
          : isBase
            ? "Base is fixed at the beginning of the layer order."
            : "Move this layer later in the order."}
        onclick={() => editor.moveLayer(1)}>Move later</Button
      >
      <Button
        variant="secondary"
        type="button"
        disabled={isBase || own > 0 || references > 0 || library.busy}
        title={isBase
          ? "The Base layer is required."
          : own || references
            ? `Remove ${count(own, "assignment")} and ${count(references, "layer action")} first.`
            : "Delete this empty, unreferenced layer."}
        class="danger"
        onclick={remove}>Delete layer</Button
      >
    </div>
    <div class="behavior-form-actions">
      <Button variant="secondary" type="button" onclick={() => editor.closeDialog()}
        >Close</Button
      >
      <Button
        variant="primary"
        disabled={library.busy || !rename.trim() || duplicateName}
        title={duplicateName ? "Layer names must be unique." : "Save the selected layer name."}
        type="submit">Rename layer</Button
      >
    </div>
  </form>
</ComplexActionDialog>
