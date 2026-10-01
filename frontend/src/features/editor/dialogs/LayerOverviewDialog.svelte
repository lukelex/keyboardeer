<script lang="ts">
  import Button from "../../../components/Button.svelte";
  import Dialog from "../../../components/Dialog.svelte";
  import KeyboardSheet from "../../../components/KeyboardSheet.svelte";
  import { baseLayerID } from "../../../domain/keymap";
  import { useApp } from "../../../state/context";

  // Every layer at once: a reference while learning a layout, and a
  // printable cheat sheet.
  const app = useApp();
  const { editor, navigation } = app;
  const keymap = $derived(editor.keymap!);
  const geometry = $derived(editor.geometry!);

  function entry(layerID: string) {
    if (layerID === baseLayerID) return "Active by default";
    return keymap.isReachable(layerID)
      ? `Entered ${keymap.entrySummary(layerID)}`
      : "No entry key yet";
  }
</script>

<Dialog
  labelledby="overview-title"
  class="behavior-dialog layer-overview"
  closeLabel="Close layer overview"
  onclose={() => (app.overviewOpen = false)}
>
  <p class="eyebrow">
    {navigation.device?.display_name || "Keyboard"} · {keymap.profile.name}
  </p>
  <h2 id="overview-title">Layer overview</h2>
  <p class="dialog-intro overview-intro">
    Every layer of this draft. Bold legends are what each key sends; dimmed keys
    fall through to Base.
  </p>
  <div class="overview-actions">
    <Button variant="primary" type="button" onclick={() => window.print()}
      >Print or save as PDF</Button
    >
  </div>
  {#each keymap.layers as layer (layer.id)}
    <section class="overview-layer" aria-labelledby={`overview-${layer.id}`}>
      <h3 id={`overview-${layer.id}`}>
        {layer.name} <small>{entry(layer.id)}</small>
      </h3>
      <KeyboardSheet {geometry} {keymap} layerID={layer.id} />
    </section>
  {/each}
</Dialog>
