<script lang="ts">
  import { browserCodeToSourceKey } from "../../domain/keys";
  import { useApp } from "../../state/context";
  import ApplyStatus from "./ApplyStatus.svelte";
  import ChangesBar from "./ChangesBar.svelte";
  import EditorHeader from "./EditorHeader.svelte";
  import EditorPalette from "./EditorPalette.svelte";
  import KeyboardCanvas from "./KeyboardCanvas.svelte";
  import { usesCompactPalette } from "./layout";
  import ProblemsPanel from "./ProblemsPanel.svelte";

  const app = useApp();
  const editor = app.editor;
  let viewportHeight = $state(0);
  let flashingKey = $state("");
  let flashTimer: ReturnType<typeof setTimeout> | undefined;
  const compact = $derived(usesCompactPalette(viewportHeight, editor.rows.length));

  const typing = (target: EventTarget | null) =>
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement;

  // Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y, unless a dialog or a text field has focus.
  function handleHistoryKey(event: KeyboardEvent) {
    if (!app.dialogs.isEmpty || event.altKey || typing(event.target)) return;
    const key = event.key.toLowerCase();
    if (key === "z" && !event.shiftKey) {
      event.preventDefault();
      void editor.undo();
    } else if ((key === "z" && event.shiftKey) || key === "y") {
      event.preventDefault();
      void editor.redo();
    }
  }

  // Pressing a physical key highlights it on the keyboard.
  function flashPressedKey(event: KeyboardEvent) {
    if (
      editor.sourceKey ||
      !app.dialogs.isEmpty ||
      event.repeat ||
      event.altKey ||
      typing(event.target)
    )
      return;
    const sourceKey = browserCodeToSourceKey[event.code];
    if (!sourceKey || !editor.geometry?.keys.some((key) => key.source_key === sourceKey))
      return;
    flashingKey = sourceKey;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => (flashingKey = ""), 240);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.ctrlKey || event.metaKey) handleHistoryKey(event);
    else flashPressedKey(event);
  }
  $effect(() => () => clearTimeout(flashTimer));
</script>

<svelte:window bind:innerHeight={viewportHeight} onkeydown={handleKeydown} />

<section
  class={["editor-page", compact && "compact-palette"]}
  aria-labelledby="editor-title"
>
  <EditorHeader />
  {#if editor.geometry}
    <div class="editor-scroll-region">
      {#if editor.applyBlockedReason && !editor.apply.busy}
        <p class="apply-blocked" role="status">
          <strong>Apply unavailable:</strong>
          {editor.applyBlockedReason}
        </p>
      {/if}
      <ProblemsPanel />
      <KeyboardCanvas {flashingKey} />
      <ChangesBar />
      <ApplyStatus />
    </div>
    <EditorPalette {compact} />
  {:else}
    <div class="editor-scroll-region">
      <section class="manager-notice" data-state="incomplete">
        <span class="notice-symbol" aria-hidden="true">!</span>
        <div>
          <h2>Geometry unavailable</h2>
          <p>This draft refers to a geometry this version cannot render.</p>
        </div>
      </section>
    </div>
  {/if}
</section>
