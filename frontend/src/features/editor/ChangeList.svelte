<script lang="ts">
  import type { ApplyDiff, ChangeKind } from "../../domain/applyDiff";
  import type { Keymap } from "../../domain/keymap";

  // Added, changed and removed layers, declarations and key behaviors, with
  // full before → after descriptions.
  let {
    diff,
    keymap,
    label,
  }: { diff: ApplyDiff; keymap: Keymap; label: string } = $props();
  const changeLabels: Record<ChangeKind, string> = {
    added: "Added",
    changed: "Changed",
    removed: "Removed",
  };
</script>

<ul class="apply-review-list" aria-label={label}>
  {#each diff.layers as change (`layer-${change.id}`)}
    <li data-change={change.kind}>
      <span class="change-kind">{changeLabels[change.kind]}</span>
      <strong>{change.name} layer</strong>
      {#if change.beforeName}<span>Renamed from {change.beforeName}</span>{/if}
    </li>
  {/each}
  {#each diff.declarations as change (`${change.type}-${change.name}`)}
    <li data-change={change.kind}>
      <span class="change-kind">{changeLabels[change.kind]}</span>
      <strong>{change.type === "alias" ? "Alias @" : "Macro #"}{change.name}</strong>
    </li>
  {/each}
  {#each diff.assignments as change (`${change.layerID}-${change.sourceKey}`)}
    <li data-change={change.kind}>
      <span class="change-kind">{changeLabels[change.kind]}</span>
      <strong
        >{keymap.layerName(change.layerID)} · {keymap.catalog.name(
          change.sourceKey,
        )}</strong
      >
      <span
        >{#if change.kind !== "added"}{keymap.describe(
            change.before,
            change.sourceKey,
            change.layerID,
          )}{" → "}{/if}{keymap.describe(
          change.after,
          change.sourceKey,
          change.layerID,
        )}</span
      >
    </li>
  {/each}
</ul>
