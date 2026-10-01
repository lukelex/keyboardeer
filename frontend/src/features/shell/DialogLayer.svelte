<script lang="ts">
  import ConfirmDialog from "../../components/ConfirmDialog.svelte";
  import { useApp } from "../../state/context";
  import ExternalSourceDialog from "../devices/ExternalSourceDialog.svelte";
  import IdentifyDialog from "../devices/IdentifyDialog.svelte";
  import AliasDialog from "../editor/dialogs/AliasDialog.svelte";
  import ApplyReviewDialog from "../editor/dialogs/ApplyReviewDialog.svelte";
  import LayerActionDialog from "../editor/dialogs/LayerActionDialog.svelte";
  import MacroDialog from "../editor/dialogs/MacroDialog.svelte";
  import ManageLayersDialog from "../editor/dialogs/ManageLayersDialog.svelte";
  import ProfilesDialog from "../editor/dialogs/ProfilesDialog.svelte";
  import RenderedConfigurationDialog from "../editor/dialogs/RenderedConfigurationDialog.svelte";
  import TapHoldDialog from "../editor/dialogs/TapHoldDialog.svelte";
  import PreferencesDialog from "../preferences/PreferencesDialog.svelte";

  // Every dialog renders here, directly inside the app shell, in stacking
  // order: the confirmation always sits on top.
  const app = useApp();
  const { editor, identify, sources } = app;
  const editing = $derived(app.editorOpen);
</script>

{#if app.preferences.open}<PreferencesDialog />{/if}
{#if editing && editor.dialog === "layers"}<ManageLayersDialog />
{:else if editing && editor.dialog === "tap_hold"}<TapHoldDialog />
{:else if editing && editor.dialog === "layer"}<LayerActionDialog />
{:else if editing && editor.dialog === "alias"}<AliasDialog />
{:else if editing && editor.dialog === "macro"}<MacroDialog />
{/if}
{#if editing && app.profileManagerOpen && app.navigation.device}<ProfilesDialog />{/if}
{#if editing && editor.apply.reviewOpen}<ApplyReviewDialog />{/if}
{#if sources.external}<ExternalSourceDialog />{/if}
{#if sources.renderedOpen && sources.rendered}<RenderedConfigurationDialog />{/if}
{#if identify.open && identify.device}<IdentifyDialog />{/if}
<ConfirmDialog confirmations={app.confirmations} />
