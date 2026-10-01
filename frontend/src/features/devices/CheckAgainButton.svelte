<script lang="ts">
  import Button from "../../components/Button.svelte";
  import { useApp } from "../../state/context";

  // Asks the manager for a fresh snapshot now, instead of waiting for the
  // automatic reconnect.
  const { connection } = useApp();
</script>

<Button
  variant="secondary"
  type="button"
  class="check-again"
  onclick={() => connection.refresh()}
  disabled={connection.loading}
  >{connection.loading ? "Checking…" : "Check again"}</Button
>
