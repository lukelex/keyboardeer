<script lang="ts">
  import { lintKeymap } from "../../domain/keymapLint";
  import { count } from "../../domain/text";
  import { useApp } from "../../state/context";

  // Design checks the manager cannot make, collapsed so they inform without
  // getting in the way.
  const { editor } = useApp();
  const suggestions = $derived(editor.keymap ? lintKeymap(editor.keymap) : []);

  function show(layerID: string, sourceKey?: string) {
    if (sourceKey) editor.select(layerID, sourceKey);
    else editor.selectLayer(layerID);
  }
</script>

{#if suggestions.length}
  <details class="suggestions-panel">
    <summary>{count(suggestions.length, "suggestion")} for this draft</summary>
    <ul>
      {#each suggestions as suggestion (suggestion.id)}
        <li>
          <span>{suggestion.message}</span>
          <button
            type="button"
            class="inline-link"
            onclick={() => show(suggestion.layerID, suggestion.sourceKey)}
            >{suggestion.sourceKey ? "Show key" : "Show layer"}</button
          >
        </li>
      {/each}
    </ul>
  </details>
{/if}
