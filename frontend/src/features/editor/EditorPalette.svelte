<script lang="ts">
  import { useApp } from "../../state/context";
  import KeyInspector from "./KeyInspector.svelte";
  import LayerToolbar from "./LayerToolbar.svelte";
  import PaletteKeys from "./PaletteKeys.svelte";

  // The bottom panel: what the selected key does, the layer and action
  // toolbar, and the keys that can be assigned.
  let { compact }: { compact: boolean } = $props();
  const app = useApp();
  let layerHelpOpen = $state(false);
</script>

<section
  class="key-palette"
  aria-label="Basic key assignments"
  bind:clientHeight={app.paletteHeight}
>
  <KeyInspector />
  {#if layerHelpOpen}
    <section class="layer-guidance" id="layer-help" aria-labelledby="layer-guidance-title">
      <strong id="layer-guidance-title">How layers work</strong>
      <p>
        Base is always active. Give a key a <b>Hold layer</b> or
        <b>Switch layer</b> action to enter another layer: a held layer ends when
        that key is released; a switched layer stays until another Switch layer
        action (normally one targeting Base). Keys with nothing set on a layer
        fall through to the layer below.
      </p>
    </section>
  {/if}
  <LayerToolbar bind:helpOpen={layerHelpOpen} />
  <PaletteKeys {compact} />
</section>
