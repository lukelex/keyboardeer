<script lang="ts">
  import { horizontalWheel } from "../../actions/horizontalWheel";
  import { rovingTabs } from "../../actions/tabs";
  import Button from "../../components/Button.svelte";
  import KeyIcon from "../../components/KeyIcon.svelte";
  import { KeyCatalog, paletteCategories } from "../../domain/keyCatalog";
  import { keyIconPaths } from "../../domain/keyIcons";
  import type { PaletteState } from "./paletteState.svelte";
  import { useApp } from "../../state/context";

  // Output keys to assign to the selected key. The full palette shows every
  // group with headings; the compact strip shows one category at a time.
  let { compact, palette }: { compact: boolean; palette: PaletteState } =
    $props();
  const { editor, library } = useApp();
  const catalog = $derived(editor.catalog);
  const searching = $derived(!!palette.search.trim());
  const matches = $derived(catalog.search(palette.search));
  const shown = $derived(
    compact ? catalog.inCategory(matches, palette.category) : matches,
  );
</script>

<div class="palette-search">
  <label for="palette-search">Search keys</label>
  <input
    id="palette-search"
    type="search"
    bind:value={palette.search}
    placeholder="Name or KMonad code"
    autocomplete="off"
  />
  {#if searching}<span>{matches.length} of {catalog.keys.length}</span>{/if}
</div>
<div
  class="palette-categories"
  role="tablist"
  aria-label="Key categories"
  tabindex="-1"
  use:rovingTabs
>
  {#each paletteCategories as item (item.id)}
    <Button
      variant="secondary"
      class={["palette-category", palette.category === item.id && "active"]}
      role="tab"
      id={`palette-category-${item.id}`}
      aria-controls="palette-category-panel"
      aria-selected={palette.category === item.id}
      tabindex={palette.category === item.id ? 0 : -1}
      onclick={() => (palette.category = item.id)}>{item.label}</Button
    >
  {/each}
</div>
<div
  class="palette-buttons"
  id="palette-category-panel"
  role="tabpanel"
  aria-labelledby={`palette-category-${palette.category}`}
  use:horizontalWheel={compact}
>
  {#each shown as key, index (key.source_key)}
    {#if !compact && !searching && (index === 0 || KeyCatalog.groupIndex(shown[index - 1]) !== KeyCatalog.groupIndex(key))}
      <h3 class="palette-group-heading">{catalog.group(key).heading}</h3>
    {/if}
    <Button
      variant="palette"
      onclick={() => editor.assign({ kind: "key", key: key.source_key })}
      disabled={library.busy || !editor.sourceKey}
      aria-label={`Assign ${catalog.name(key.source_key)} (${key.source_key})`}
      title={`${catalog.name(key.source_key)} (${key.source_key})`}
      >{#if keyIconPaths[key.source_key]}<KeyIcon name={key.source_key} />{:else}<span
          >{catalog.capLabel(key)}</span
        >{/if}<small>{key.source_key}</small></Button
    >
  {:else}
    <p class="palette-empty">
      {searching
        ? `No keys match “${palette.search.trim()}”.`
        : "No keys in this category."}
    </p>
  {/each}
</div>
