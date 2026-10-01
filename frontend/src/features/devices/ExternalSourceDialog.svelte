<script lang="ts">
  import Dialog from "../../components/Dialog.svelte";
  import { formatKMonad } from "../../domain/kmonadFormat";
  import { useApp } from "../../state/context";

  const { sources } = useApp();
  const configuration = $derived(sources.external!);
</script>

<Dialog
  labelledby="external-dialog-title"
  class="behavior-dialog external-dialog"
  closeLabel="Close external configuration source"
  onclose={() => sources.closeExternal()}
>
  <p class="eyebrow">MANAGER-OWNED · EXTERNAL</p>
  <h2 id="external-dialog-title">
    {configuration.name || "Unnamed external configuration"}
  </h2>
  <p class="dialog-intro">
    This configuration is not a KeyboarDeer profile; the manager runs it as-is.
    Adopting it hands its lifecycle to KeyboarDeer only when the manager can
    represent it without loss.
  </p>
  {#if sources.externalContent}
    <section class="raw-external-content">
      <div class="raw-external-heading">
        <strong
          >Raw KMonad source · revision {sources.externalContent
            .content_revision}</strong
        >
        <small>{sources.externalContent.digest}</small>
      </div>
      <pre class="raw-configuration-content"><code
          >{formatKMonad(sources.externalContent.content)}</code
        ></pre>
    </section>
  {:else if sources.externalBusy}
    <p class="dialog-intro" role="status">Loading source…</p>
  {:else}
    <section class="raw-external-unavailable">
      <strong>Raw KMonad source is unavailable</strong>
      <p>
        The manager has not shared this configuration's source. Newer manager
        versions provide it through an access-controlled API; KeyboarDeer never
        reads manager-owned files directly.
      </p>
    </section>
  {/if}
</Dialog>
