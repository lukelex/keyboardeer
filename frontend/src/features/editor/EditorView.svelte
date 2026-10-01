<script lang="ts">
  import { tick } from "svelte";
  import { KeyboardGrid } from "../../domain/keyboardGrid";
  import { browserCodeToSourceKey } from "../../domain/keys";
  import { useApp } from "../../state/context";
  import ApplyStatus from "./ApplyStatus.svelte";
  import ChangesBar from "./ChangesBar.svelte";
  import EditorHeader from "./EditorHeader.svelte";
  import EditorPalette from "./EditorPalette.svelte";
  import KeyboardCanvas from "./KeyboardCanvas.svelte";
  import { usesCompactPalette } from "./layout";
  import { PaletteState } from "./paletteState.svelte";
  import ProblemsPanel from "./ProblemsPanel.svelte";
  import SuggestionsPanel from "./SuggestionsPanel.svelte";
  import { resolveShortcut, type EditorCommand } from "./shortcuts";

  const app = useApp();
  const editor = app.editor;
  const palette = new PaletteState();
  let viewportHeight = $state(0);
  let flashingKey = $state("");
  let flashTimer: ReturnType<typeof setTimeout> | undefined;
  const compact = $derived(usesCompactPalette(viewportHeight, editor.rows.length));
  const grid = $derived(editor.geometry ? new KeyboardGrid(editor.geometry) : null);
  // The output being looked up: a hovered or focused palette key, or the
  // only match of the palette search.
  const lookup = $derived.by(() => {
    if (palette.inspecting) return palette.inspecting;
    const matches = palette.search.trim() ? editor.catalog.search(palette.search) : [];
    return matches.length === 1 ? matches[0].source_key : "";
  });
  const findings = $derived(lookup && editor.keymap ? editor.keymap.findOutput(lookup) : []);
  const foundHere = $derived(
    new Set(
      findings
        .filter((finding) => finding.layerID === editor.layerID)
        .map((finding) => finding.sourceKey),
    ),
  );
  const layoutKeys = $derived(
    new Set(editor.geometry?.keys.map((key) => key.source_key) ?? []),
  );

  function flash(sourceKey: string) {
    flashingKey = sourceKey;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => (flashingKey = ""), 240);
  }

  /** Selects a key and moves focus to it, so the selection is visible. */
  async function selectAndFocus(sourceKey: string) {
    editor.select(editor.layerID, sourceKey);
    flash(sourceKey);
    await tick();
    const key = document.querySelector<HTMLElement>(
      `.editor-key[data-source-key="${CSS.escape(sourceKey)}"]`,
    );
    key?.focus({ preventScroll: true });
    key?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  async function run(command: EditorCommand) {
    switch (command.kind) {
      case "undo":
        return editor.undo();
      case "redo":
        return editor.redo();
      case "help":
        app.shortcutsOpen = true;
        return;
      case "select":
        return selectAndFocus(command.sourceKey);
      case "move": {
        const next = grid?.neighbor(editor.sourceKey, command.direction);
        if (next) await selectAndFocus(next);
        return;
      }
      case "deselect":
        editor.clearSelection();
        return;
      case "restore":
        return editor.restoreSelected();
      case "search":
        palette.startSearch(command.text);
        await tick();
        document.getElementById("palette-search")?.focus();
        return;
    }
  }

  const sourceKeyFor = (code: string) => {
    const sourceKey = browserCodeToSourceKey[code];
    return sourceKey && layoutKeys.has(sourceKey) ? sourceKey : undefined;
  };

  // Modifiers are selected only when tapped alone, so Shift+? or Ctrl+Z
  // never select Shift or Ctrl on the way.
  const modifierKeys = new Set(["Shift", "Control", "Alt", "Meta"]);
  let tappedModifier = "";

  function handleKeydown(event: KeyboardEvent) {
    // A dialog, menu or picker already handled it, or one is open.
    if (event.defaultPrevented || !app.dialogs.isEmpty) return;
    if (modifierKeys.has(event.key)) {
      tappedModifier = editor.sourceKey || event.repeat ? "" : event.code;
      return;
    }
    tappedModifier = "";
    const command = resolveShortcut(event, {
      selected: editor.sourceKey,
      sourceKeyFor,
    });
    if (!command) return;
    event.preventDefault();
    void run(command);
  }

  function handleKeyup(event: KeyboardEvent) {
    const code = tappedModifier;
    tappedModifier = "";
    if (code !== event.code || !app.dialogs.isEmpty || editor.sourceKey) return;
    const sourceKey = sourceKeyFor(code);
    if (sourceKey) void run({ kind: "select", sourceKey });
  }
  $effect(() => () => clearTimeout(flashTimer));
</script>

<svelte:window
  bind:innerHeight={viewportHeight}
  onkeydown={handleKeydown}
  onkeyup={handleKeyup}
/>

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
      <SuggestionsPanel />
      <KeyboardCanvas {flashingKey} found={foundHere} />
      <ChangesBar />
      <ApplyStatus />
    </div>
    <EditorPalette {compact} {palette} {lookup} {findings} />
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
