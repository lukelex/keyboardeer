<script lang="ts">
  import { count } from "../../domain/text";
  import { useApp } from "../../state/context";

  // How much of the draft is not on the keyboard yet, with a toggle that
  // marks those keys on the keyboard.
  const { editor } = useApp();
  const changes = $derived(editor.applyDiff?.assignments ?? []);
  const here = $derived(changes.filter((change) => change.layerID === editor.layerID));
  const elsewhere = $derived(
    [...new Set(changes.filter((change) => change.layerID !== editor.layerID).map((change) => change.layerID))]
      .map((id) => editor.keymap?.layerName(id))
      .join(", "),
  );
</script>

{#if changes.length}
  <div class="changes-bar">
    <span
      >{editor.profile?.applied
        ? `${count(changes.length, "key change")} since the last Apply.`
        : `${count(changes.length, "key change")} to apply for the first time.`}</span
    >
    <button
      type="button"
      class="changes-toggle"
      aria-pressed={editor.showChanges}
      onclick={() => (editor.showChanges = !editor.showChanges)}
      >{editor.showChanges ? "Hide on keyboard" : "Show on keyboard"}</button
    >
    {#if editor.showChanges}
      <span class="changes-legend" aria-hidden="true">
        <i data-change="added"></i>Added <i data-change="changed"></i>Changed
        <i data-change="removed"></i>Removed
      </span>
      {#if !here.length && elsewhere}
        <span class="changes-elsewhere">Changes are on {elsewhere}.</span>
      {/if}
    {/if}
  </div>
{/if}
