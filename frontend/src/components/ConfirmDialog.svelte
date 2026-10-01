<script lang="ts">
  import type { ConfirmationService } from "../state/confirmations.svelte";
  import Button from "./Button.svelte";
  import Dialog from "./Dialog.svelte";

  // Opens above any current dialog with focus on the safe choice; Escape
  // answers "no".
  let { confirmations }: { confirmations: ConfirmationService } = $props();
</script>

{#if confirmations.current}
  {@const request = confirmations.current}
  <Dialog
    alert
    labelledby="confirm-title"
    describedby="confirm-message"
    class="behavior-dialog confirm-dialog"
    backdropClass="behavior-dialog-backdrop confirm-backdrop"
    onclose={() => confirmations.settle(false)}
  >
    <h2 id="confirm-title">{request.title}</h2>
    <p id="confirm-message" class="dialog-intro">{request.message}</p>
    <div class="behavior-form-actions">
      <Button
        variant="secondary"
        type="button"
        autofocus
        onclick={() => confirmations.settle(false)}
        >{request.cancelLabel}</Button
      >
      <Button
        variant={request.danger ? "danger" : "primary"}
        type="button"
        onclick={() => confirmations.settle(true)}>{request.confirmLabel}</Button
      >
    </div>
  </Dialog>
{/if}
