<script lang="ts">
  import type { Snippet } from "svelte";
  import { modal } from "../actions/modal";
  import { useDialogStack } from "../state/context";
  import Button from "./Button.svelte";

  // A modal dialog. It registers with the dialog stack so Escape closes the
  // topmost dialog only, and renders its backdrop where the parent places it
  // (always directly inside `.app-shell`; see actions/modal.ts).
  interface Props {
    labelledby: string;
    describedby?: string;
    onclose: () => void;
    /** Accessible name of the close button; omit to hide it. */
    closeLabel?: string;
    closeTitle?: string;
    alert?: boolean;
    class?: string;
    backdropClass?: string;
    closeClass?: string;
    /** Closes when the backdrop itself is clicked. */
    closeOnBackdrop?: boolean;
    children: Snippet;
  }
  let {
    labelledby,
    describedby,
    onclose,
    closeLabel,
    closeTitle = "Close",
    alert = false,
    class: dialogClass = "behavior-dialog",
    backdropClass = "behavior-dialog-backdrop",
    closeClass = "behavior-dialog-close",
    closeOnBackdrop = false,
    children,
  }: Props = $props();

  const dialogs = useDialogStack();
  $effect(() => dialogs.push(() => onclose()));
</script>

<div
  class={backdropClass}
  role="presentation"
  onclick={(event) => {
    if (closeOnBackdrop && event.target === event.currentTarget) onclose();
  }}
>
  <dialog
    class={dialogClass}
    open
    use:modal
    role={alert ? "alertdialog" : undefined}
    aria-modal="true"
    aria-labelledby={labelledby}
    aria-describedby={describedby}
  >
    {#if closeLabel}
      <Button
        variant="icon"
        class={closeClass}
        onclick={onclose}
        aria-label={closeLabel}
        title={closeTitle}>×</Button
      >
    {/if}
    {@render children()}
  </dialog>
</div>
