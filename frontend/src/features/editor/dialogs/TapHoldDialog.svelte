<script lang="ts">
  import Button from "../../../components/Button.svelte";
  import KeyPicker from "../../../components/KeyPicker.svelte";
  import {
    tapHoldBehavior,
    tapHoldDefaults,
  } from "../../../domain/actionDefaults";
  import { browserCodeToSourceKey } from "../../../domain/keys";
  import { defaultTapHoldTimeoutMS } from "../../../domain/keymap";
  import { useApp } from "../../../state/context";
  import ComplexActionDialog from "./ComplexActionDialog.svelte";
  import { actionContext } from "./context";

  const { editor, library } = useApp();
  const values = $state(tapHoldDefaults(actionContext(editor)));
  const choices = $derived(editor.catalog.choiceGroups());

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!values.tapKey || !values.holdKey) return;
    if (values.timeoutMS <= 0 || values.timeoutMS > 10_000) return;
    if (await editor.assign(tapHoldBehavior(values))) editor.closeDialog();
  }
</script>

<ComplexActionDialog title="Tap & hold">
  <p class="dialog-intro">
    Choose what happens for a quick tap and what happens while the key is held.
    The manager validates the complete draft before it can be applied.
  </p>
  <p class="timing-explanation">
    <strong>{defaultTapHoldTimeoutMS} ms default:</strong> release before the
    timeout to send the tap action; keep holding beyond it to use the hold action.
    A held layer stays active only while this key remains pressed.
  </p>
  <form class="behavior-form" onsubmit={submit}>
    <label for="tap-key">Tap</label>
    <KeyPicker
      id="tap-key"
      bind:value={values.tapKey}
      groups={choices}
      captureMap={browserCodeToSourceKey}
    />
    <label for="hold-type">Hold</label>
    <select id="hold-type" bind:value={values.holdMode}>
      <option value="key">Send a key</option>
      <option value="layer">Hold a layer</option>
    </select>
    {#if values.holdMode === "key"}
      <label for="hold-key">Held key</label>
      <KeyPicker
        id="hold-key"
        bind:value={values.holdKey}
        groups={choices}
        captureMap={browserCodeToSourceKey}
      />
    {:else}
      <label for="tap-hold-layer">Layer while held</label>
      <select id="tap-hold-layer" bind:value={values.holdLayerID}>
        {#each editor.keymap!.layers as layer (layer.id)}
          <option value={layer.id}>{layer.name}</option>
        {/each}
      </select>
    {/if}
    <label for="tap-hold-timeout">Tap timeout (milliseconds)</label>
    <input
      id="tap-hold-timeout"
      type="number"
      bind:value={values.timeoutMS}
      min="1"
      max="10000"
      required
    />
    <div class="behavior-form-actions">
      <Button variant="secondary" type="button" onclick={() => editor.closeDialog()}
        >Cancel</Button
      >
      <Button variant="primary" disabled={library.busy} type="submit"
        >{values.editing ? "Update tap & hold" : "Assign tap & hold"}</Button
      >
    </div>
  </form>
</ComplexActionDialog>
