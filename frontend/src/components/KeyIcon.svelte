<script lang="ts">
  import { keyIconPaths } from "../domain/keyIcons";

  let { name }: { name: string } = $props();
</script>

<svg class="key-icon" viewBox="0 0 24 24" aria-hidden="true" data-icon={name}>
  {#each keyIconPaths[name] ?? [] as path}<path d={path} />{/each}
</svg>
