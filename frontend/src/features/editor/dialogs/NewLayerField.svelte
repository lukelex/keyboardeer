<script lang="ts">
  import Button from "../../../components/Button.svelte";
  import { useApp } from "../../../state/context";

  // Adds a layer by name; the new layer is selected automatically.
  interface Props {
    id: string;
    label: string;
    hint?: string;
    oncreated?: (layerID: string) => void;
    onerror: (message: string) => void;
  }
  let { id, label, hint, oncreated, onerror }: Props = $props();
  const { editor, library } = useApp();
  let name = $state("");

  async function create() {
    const result = await editor.createLayer(name);
    if (!result.ok) {
      if (result.error) onerror(result.error);
      return;
    }
    name = "";
    onerror("");
    if (result.id) oncreated?.(result.id);
  }
</script>

<div class="new-layer-control">
  <label for={id}>{label}</label>
  <div>
    <input {id} bind:value={name} maxlength="40" placeholder="Navigation" />
    <Button
      variant="secondary"
      type="button"
      disabled={library.busy || !name.trim()}
      onclick={create}>Add layer</Button
    >
  </div>
  {#if hint}<small>{hint}</small>{/if}
</div>
