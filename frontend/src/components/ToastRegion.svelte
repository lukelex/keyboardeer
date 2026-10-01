<script lang="ts">
  import type { ToastCenter } from "../state/toasts.svelte";

  // Results are announced politely; errors as alerts. The region stays
  // operable while a dialog is open (see actions/modal.ts).
  let {
    toasts,
    bottomOffset = 0,
  }: { toasts: ToastCenter; bottomOffset?: number } = $props();
</script>

<div
  class="toast-region"
  aria-label="Notifications"
  style:bottom={bottomOffset ? `${bottomOffset}px` : null}
>
  <div role="status" aria-live="polite">
    {#each toasts.results as toast (toast.id)}
      <p class="toast" data-tone={toast.tone}>
        <span>{toast.message}</span>
        <button
          type="button"
          class="toast-dismiss"
          aria-label="Dismiss notification"
          onclick={() => toasts.dismiss(toast.id)}>×</button
        >
      </p>
    {/each}
  </div>
  <div role="alert">
    {#each toasts.errors as toast (toast.id)}
      <p class="toast" data-tone="error">
        <span>{toast.message}</span>
        <button
          type="button"
          class="toast-dismiss"
          aria-label="Dismiss error"
          onclick={() => toasts.dismiss(toast.id)}>×</button
        >
      </p>
    {/each}
  </div>
</div>
