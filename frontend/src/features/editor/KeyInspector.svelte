<script lang="ts">
  import Button from "../../components/Button.svelte";
  import { baseLayerID } from "../../domain/keymap";
  import { useApp } from "../../state/context";
  import type { ComplexAction } from "../../state/editor.svelte";

  // The selected key's full behavior, what falls through from Base, and the
  // actions that apply to it.
  const { editor, library } = useApp();
  const keymap = $derived(editor.keymap!);
  const behavior = $derived(editor.selectedBehavior);
  const onBase = $derived(editor.layerID === baseLayerID);
  const multiple = $derived(editor.multipleSelected);
  const anyRemapped = $derived(
    editor.selectedKeys.some((key) => keymap.behaviorAt(editor.layerID, key)),
  );
  const allDisabled = $derived(
    editor.selectedKeys.every(
      (key) => keymap.behaviorAt(editor.layerID, key)?.kind === "disabled",
    ),
  );
  const selectedNames = $derived(
    editor.selectedKeys
      .map(
        (sourceKey) =>
          editor.geometry?.keys.find((key) => key.source_key === sourceKey)
            ?.label ?? sourceKey,
      )
      .join(", "),
  );
  const fallthrough = $derived(
    editor.sourceKey && keymap.fallsThrough(editor.layerID, editor.sourceKey)
      ? keymap.describe(
          keymap.behaviorAt(baseLayerID, editor.sourceKey),
          editor.sourceKey,
          baseLayerID,
        )
      : "",
  );
  const editable = $derived(
    (
      {
        tap_hold: "tap_hold",
        hold_layer: "layer",
        switch_layer: "layer",
        alias: "alias",
        macro: "macro",
      } as Record<string, ComplexAction>
    )[behavior?.kind ?? ""],
  );
  const actionNames: Record<ComplexAction, string> = {
    tap_hold: "tap & hold",
    layer: "layer action",
    alias: "alias",
    macro: "macro",
    layers: "layers",
    recipes: "recipes",
  };
</script>

<div
  class={["key-inspector", !editor.sourceKey && "empty"]}
  aria-label="Selected key"
  role="group"
>
  <div class="selected-key-context" aria-live="polite" aria-atomic="true">
    <strong
      >{multiple
        ? `${editor.selectedKeys.length} keys`
        : editor.sourceKey
          ? (editor.selectedKey?.label ?? editor.sourceKey)
          : "Select a key"}</strong
    >
    <span>{editor.activeLayer ? `${editor.activeLayer.name} layer` : "No active layer"}</span>
    {#if editor.activeLayer && !keymap.isReachable(editor.activeLayer.id)}
      <em>Needs an entry action</em>
    {/if}
    {#if multiple}
      <p class="key-inspector-behavior">
        {selectedNames}<small
          >Palette keys and the actions here change all of them.</small
        >
      </p>
    {:else if editor.sourceKey}
      <p class="key-inspector-behavior">
        {keymap.describe(behavior, editor.sourceKey, editor.layerID)}{#if fallthrough}<small
            >Base: {fallthrough}</small
          >{/if}
      </p>
    {:else}
      <p class="key-inspector-hint">
        Click a key, or press it on your keyboard, to change it; Ctrl-click to
        select several. Press ? for keyboard shortcuts.
        {#if !keymap.assignments.length}
          <button
            type="button"
            class="inline-link"
            onclick={() => editor.openDialog("recipes")}
            >New to remapping? Start from a recipe.</button
          >
        {/if}
      </p>
    {/if}
  </div>
  {#if editor.sourceKey}
    <div class="key-inspector-actions">
      {#if editable && !multiple}
        <Button
          variant="secondary"
          type="button"
          onclick={() => editor.openDialog(editable)}
          disabled={library.busy}>Edit {actionNames[editable]}</Button
        >
      {/if}
      <Button
        variant="secondary"
        type="button"
        onclick={() => editor.restoreSelected()}
        disabled={library.busy || !anyRemapped}
        title={anyRemapped
          ? "Remove this layer's assignment for the key."
          : "This key has no assignment on this layer."}>Restore original</Button
      >
      <Button
        variant="secondary"
        type="button"
        onclick={() => editor.assign({ kind: "disabled" })}
        disabled={library.busy || allDisabled}
        title="Make the selected keys send nothing on this layer."
        >{multiple ? "Disable keys" : "Disable key"}</Button
      >
      <Button
        variant="secondary"
        type="button"
        onclick={() => editor.assign({ kind: "transparent" })}
        disabled={library.busy || onBase || behavior?.kind === "transparent"}
        title={onBase
          ? "The Base layer cannot fall through."
          : "Let this key fall through to the layer below."}>Pass through</Button
      >
    </div>
  {/if}
</div>
