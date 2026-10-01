<script lang="ts">
  import type { Snippet } from "svelte";
  import Dialog from "../../../components/Dialog.svelte";
  import { useApp } from "../../../state/context";

  // The shared frame of the complex-action dialogs: the selected key, any
  // validation message for the dialog's fields, and its title.
  let {
    title,
    error = "",
    children,
  }: { title: string; error?: string; children: Snippet } = $props();
  const { editor } = useApp();
</script>

<Dialog
  labelledby="behavior-dialog-title"
  closeLabel="Close complex action dialog"
  onclose={() => editor.closeDialog()}
>
  <p class="eyebrow">COMPLEX ACTION · {editor.sourceKey}</p>
  {#if error}
    <p class="dialog-error" role="alert">{error}</p>
  {/if}
  <h2 id="behavior-dialog-title">{title}</h2>
  {@render children()}
</Dialog>
