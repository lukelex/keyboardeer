<script lang="ts">
  import Button from "../../../components/Button.svelte";
  import { layerActionDefaults } from "../../../domain/actionDefaults";
  import { useApp } from "../../../state/context";
  import ComplexActionDialog from "./ComplexActionDialog.svelte";
  import { actionContext } from "./context";
  import NewLayerField from "./NewLayerField.svelte";

  const { editor, library } = useApp();
  const values = $state(layerActionDefaults(actionContext(editor)));
  let error = $state("");

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!values.targetID) return;
    if (await editor.assign({ kind: values.action, target: values.targetID })) {
      editor.closeDialog();
    }
  }
</script>

<ComplexActionDialog title="Layer action" {error}>
  <p class="dialog-intro">
    Hold a layer temporarily, or switch to it until another layer action changes
    the active layer.
  </p>
  <p class="timing-explanation">
    <strong>Layer entry and exit:</strong> a held layer ends when this key is
    released. A switched layer stays active until another Switch layer action,
    normally one targeting Base, changes it, so give that layer a way back.
  </p>
  <form class="behavior-form" onsubmit={submit}>
    <label for="layer-action">When this key is pressed</label>
    <select id="layer-action" bind:value={values.action}>
      <option value="hold_layer">Hold this layer</option>
      <option value="switch_layer">Switch to this layer</option>
    </select>
    <label for="layer-target">Target layer</label>
    <select id="layer-target" bind:value={values.targetID}>
      {#each editor.keymap!.layers as layer (layer.id)}
        <option value={layer.id}>{layer.name}</option>
      {/each}
    </select>
    <NewLayerField
      id="new-layer-name"
      label="Or add a layer"
      oncreated={(id) => (values.targetID = id)}
      onerror={(message) => (error = message)}
    />
    <div class="behavior-form-actions">
      <Button variant="secondary" type="button" onclick={() => editor.closeDialog()}
        >Cancel</Button
      >
      <Button variant="primary" disabled={library.busy} type="submit"
        >{values.editing ? "Update layer action" : "Assign layer action"}</Button
      >
    </div>
  </form>
</ComplexActionDialog>
