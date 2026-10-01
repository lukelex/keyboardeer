<script lang="ts">
  import Dialog from "../../../components/Dialog.svelte";
  import { formatKMonad } from "../../../domain/kmonadFormat";
  import { useApp } from "../../../state/context";

  // The runnable .kbd the manager rendered for this keyboard.
  const { sources } = useApp();
</script>

<Dialog
  labelledby="raw-configuration-title"
  class="behavior-dialog raw-configuration-dialog"
  closeLabel="Close KMonad configuration"
  onclose={() => sources.closeRendered()}
>
  <p class="eyebrow">MANAGER-RENDERED · DEVICE-BOUND</p>
  <h2 id="raw-configuration-title">KMonad configuration</h2>
  <p class="dialog-intro">
    This is the runnable configuration rendered by the manager for this keyboard.
    Device-specific input/output settings are manager-owned.
  </p>
  <pre class="raw-configuration-content"><code
      >{formatKMonad(sources.rendered?.content ?? "")}</code
    ></pre>
</Dialog>
