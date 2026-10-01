<script lang="ts">
  import Button from "../../../components/Button.svelte";
  import KeyPicker from "../../../components/KeyPicker.svelte";
  import { macroDefaults } from "../../../domain/actionDefaults";
  import { browserCodeToSourceKey } from "../../../domain/keys";
  import { useApp } from "../../../state/context";
  import ComplexActionDialog from "./ComplexActionDialog.svelte";
  import { actionContext } from "./context";

  const { editor, library } = useApp();
  const values = $state(macroDefaults(actionContext(editor)));
  let error = $state("");
  const updating = $derived(!!values.editing && values.name === values.editing);

  function move(index: number, direction: -1 | 1) {
    const destination = index + direction;
    if (destination < 0 || destination >= values.steps.length) return;
    const steps = [...values.steps];
    [steps[index], steps[destination]] = [steps[destination], steps[index]];
    values.steps = steps;
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    const result = await editor.defineMacro(values.name, values.steps, values.editing);
    if (result.ok) editor.closeDialog();
    else error = result.error;
  }
</script>

<ComplexActionDialog title="Macro sequence" {error}>
  <p class="dialog-intro">
    Build an ordered sequence of key presses. It will be saved as a named macro
    and assigned to the selected key.
  </p>
  {#if values.editing}
    <p class="timing-explanation">
      Changing the steps updates every key that uses #{values.editing}.
    </p>
  {/if}
  <form class="behavior-form" onsubmit={submit}>
    <label for="macro-name">Macro name</label>
    <input
      id="macro-name"
      bind:value={values.name}
      maxlength="40"
      pattern="[A-Za-z][A-Za-z0-9-]*"
      placeholder="paste-line"
      required
    />
    <label for="macro-next-key">Add a key press</label>
    <div class="macro-step-control">
      <KeyPicker
        id="macro-next-key"
        bind:value={values.nextKey}
        groups={editor.catalog.choiceGroups()}
        captureMap={browserCodeToSourceKey}
      />
      <Button
        variant="secondary"
        type="button"
        onclick={() => {
          if (values.nextKey) values.steps = [...values.steps, values.nextKey];
        }}>Add</Button
      >
    </div>
    <ol class="macro-steps" aria-label="Macro key sequence">
      {#each values.steps as step, index (`${step}-${index}`)}
        <li>
          <span>{editor.catalog.name(step)} <small>{step}</small></span>
          <span class="macro-step-actions">
            <Button
              variant="plain"
              type="button"
              disabled={index === 0}
              aria-label={`Move step ${index + 1} earlier`}
              title="Move earlier"
              onclick={() => move(index, -1)}>↑</Button
            >
            <Button
              variant="plain"
              type="button"
              disabled={index === values.steps.length - 1}
              aria-label={`Move step ${index + 1} later`}
              title="Move later"
              onclick={() => move(index, 1)}>↓</Button
            >
            <Button
              variant="plain"
              class="macro-remove"
              type="button"
              aria-label={`Remove step ${index + 1}`}
              onclick={() =>
                (values.steps = values.steps.filter((_, other) => other !== index))}
              >Remove</Button
            >
          </span>
        </li>
      {/each}
    </ol>
    <div class="behavior-form-actions">
      <Button variant="secondary" type="button" onclick={() => editor.closeDialog()}
        >Cancel</Button
      >
      <Button
        variant="primary"
        disabled={library.busy || !values.steps.length}
        type="submit">{updating ? "Update macro" : "Create and assign macro"}</Button
      >
    </div>
  </form>
</ComplexActionDialog>
