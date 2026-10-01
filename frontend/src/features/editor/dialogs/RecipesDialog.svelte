<script lang="ts">
  import Button from "../../../components/Button.svelte";
  import Dialog from "../../../components/Dialog.svelte";
  import { diffAgainstApplied } from "../../../domain/applyDiff";
  import { Keymap } from "../../../domain/keymap";
  import { recipeUnavailableReason, recipes } from "../../../domain/recipes";
  import { useApp } from "../../../state/context";
  import ChangeList from "../ChangeList.svelte";

  // Ready-made setups, each previewed as the exact changes it would make.
  const { editor, library } = useApp();
  const keymap = $derived(editor.keymap!);
  let selectedID = $state(recipes[0].id);
  const recipe = $derived(recipes.find((item) => item.id === selectedID)!);
  const unavailable = $derived(
    recipeUnavailableReason(recipe, keymap.profile, editor.catalog),
  );
  const result = $derived(unavailable ? null : recipe.apply(keymap));
  const diff = $derived(result ? diffAgainstApplied(keymap.profile, result) : null);
  const resultKeymap = $derived(result ? new Keymap(result, editor.catalog) : null);

  async function add() {
    if (await editor.applyRecipe(recipe)) editor.closeDialog();
  }
</script>

<Dialog
  labelledby="recipes-title"
  class="behavior-dialog recipes-dialog"
  closeLabel="Close recipes"
  onclose={() => editor.closeDialog()}
>
  <p class="eyebrow">READY-MADE SETUPS</p>
  <h2 id="recipes-title">Recipes</h2>
  <p class="dialog-intro">
    A recipe adds ordinary key assignments to this draft in one step. You can
    edit them afterwards, undo the whole recipe, and nothing reaches the
    keyboard until you apply.
  </p>
  <div class="recipe-body">
  <div class="recipe-list" role="radiogroup" aria-label="Recipes">
    {#each recipes as item (item.id)}
      {@const reason = recipeUnavailableReason(item, keymap.profile, editor.catalog)}
      <button
        type="button"
        role="radio"
        class={["recipe", selectedID === item.id && "selected"]}
        aria-checked={selectedID === item.id}
        onclick={() => (selectedID = item.id)}
      >
        <strong>{item.name}</strong>
        <small>{reason || item.summary}</small>
      </button>
    {/each}
  </div>
  <section class="recipe-preview" aria-labelledby="recipe-preview-title">
    <h3 id="recipe-preview-title">What “{recipe.name}” changes</h3>
    {#if unavailable}
      <p class="apply-review-empty">{unavailable}</p>
    {:else if diff?.count && resultKeymap}
      <ChangeList {diff} keymap={resultKeymap} label="Recipe changes" />
    {:else}
      <p class="apply-review-empty">This draft already does all of this.</p>
    {/if}
  </section>
  </div>
  <div class="behavior-form-actions">
    <Button variant="secondary" type="button" onclick={() => editor.closeDialog()}
      >Cancel</Button
    >
    <Button
      variant="primary"
      type="button"
      disabled={library.busy || !!unavailable || !diff?.count}
      onclick={add}>Add to draft</Button
    >
  </div>
</Dialog>
