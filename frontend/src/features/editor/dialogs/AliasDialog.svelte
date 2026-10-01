<script lang="ts">
  import Button from "../../../components/Button.svelte";
  import KeyPicker from "../../../components/KeyPicker.svelte";
  import { aliasDefaults } from "../../../domain/actionDefaults";
  import { browserCodeToSourceKey } from "../../../domain/keys";
  import { useApp } from "../../../state/context";
  import ComplexActionDialog from "./ComplexActionDialog.svelte";
  import { actionContext } from "./context";

  const { editor, library } = useApp();
  const values = $state(aliasDefaults(actionContext(editor)));
  let error = $state("");
  const updating = $derived(!!values.editing && values.name === values.editing);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    const result = await editor.defineAlias(values.name, values.key, values.editing);
    if (result.ok) editor.closeDialog();
    else error = result.error;
  }
</script>

<ComplexActionDialog title="Named alias" {error}>
  <p class="dialog-intro">
    Save a reusable name for a key action, then assign that alias to the selected
    key.
  </p>
  {#if values.editing}
    <p class="timing-explanation">
      Changing the action updates every key that uses @{values.editing}.
    </p>
  {/if}
  <form class="behavior-form" onsubmit={submit}>
    <label for="alias-name">Alias name</label>
    <input
      id="alias-name"
      bind:value={values.name}
      maxlength="40"
      pattern="[A-Za-z][A-Za-z0-9-]*"
      placeholder="escape-key"
      required
    />
    <label for="alias-key">Action</label>
    <KeyPicker
      id="alias-key"
      bind:value={values.key}
      groups={editor.catalog.choiceGroups()}
      captureMap={browserCodeToSourceKey}
    />
    <div class="behavior-form-actions">
      <Button variant="secondary" type="button" onclick={() => editor.closeDialog()}
        >Cancel</Button
      >
      <Button variant="primary" disabled={library.busy} type="submit"
        >{updating ? "Update alias" : "Create and assign alias"}</Button
      >
    </div>
  </form>
</ComplexActionDialog>
