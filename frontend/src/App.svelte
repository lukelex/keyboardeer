<script lang="ts">
  import { onMount } from "svelte";
  import ToastRegion from "./components/ToastRegion.svelte";
  import DevicesView from "./features/devices/DevicesView.svelte";
  import EditorView from "./features/editor/EditorView.svelte";
  import SetupView from "./features/setup/SetupView.svelte";
  import AppHeader from "./features/shell/AppHeader.svelte";
  import DialogLayer from "./features/shell/DialogLayer.svelte";
  import { KeyboarDeer } from "./state/app.svelte";
  import { provideApp, provideDialogStack } from "./state/context";

  // The composition root: one application instance for the whole tree.
  const app = new KeyboarDeer();
  provideApp(app);
  provideDialogStack(app.dialogs);
  onMount(() => app.start());

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Escape" && app.dialogs.closeTop()) event.preventDefault();
  }
</script>

<svelte:head><title>{app.info.name}</title></svelte:head>
<svelte:window onkeydown={handleKeydown} />

<div class={["app-shell", app.editorOpen && "editor-mode"]}>
  <AppHeader />
  <main class={[app.editorOpen && "editor-main"]}>
    {#if app.navigation.view === "devices"}
      <DevicesView />
    {:else if app.navigation.view === "setup" && app.navigation.device}
      <SetupView />
    {:else if app.editorOpen}
      <EditorView />
    {/if}
  </main>
  <!-- Dialogs and toasts render directly inside the shell so an open dialog
       can make the header and main content inert. -->
  <DialogLayer />
  <ToastRegion
    toasts={app.toasts}
    bottomOffset={app.editorOpen && app.paletteHeight ? app.paletteHeight + 12 : 0}
  />
</div>
