<script lang="ts">
  import ConfirmDialog from "../../components/ConfirmDialog.svelte";
  import { useApp } from "../../state/context";
  import ExternalSourceDialog from "../devices/ExternalSourceDialog.svelte";
  import IdentifyDialog from "../devices/IdentifyDialog.svelte";
  import AliasDialog from "../editor/dialogs/AliasDialog.svelte";
  import ApplyReviewDialog from "../editor/dialogs/ApplyReviewDialog.svelte";
  import LayerActionDialog from "../editor/dialogs/LayerActionDialog.svelte";
  import LayerOverviewDialog from "../editor/dialogs/LayerOverviewDialog.svelte";
  import MacroDialog from "../editor/dialogs/MacroDialog.svelte";
  import ManageLayersDialog from "../editor/dialogs/ManageLayersDialog.svelte";
  import ProfilesDialog from "../editor/dialogs/ProfilesDialog.svelte";
  import RecipesDialog from "../editor/dialogs/RecipesDialog.svelte";
  import RenderedConfigurationDialog from "../editor/dialogs/RenderedConfigurationDialog.svelte";
  import ShortcutsDialog from "../editor/dialogs/ShortcutsDialog.svelte";
  import TapHoldDialog from "../editor/dialogs/TapHoldDialog.svelte";
  import TrialDialog from "../editor/dialogs/TrialDialog.svelte";
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
{:else if editing && editor.dialog === "recipes"}<RecipesDialog />
{/if}
{#if editing && app.profileManagerOpen && app.navigation.device}<ProfilesDialog />{/if}
{#if editing && editor.apply.reviewOpen}<ApplyReviewDialog />{/if}
{#if editing && app.shortcutsOpen}<ShortcutsDialog />{/if}
{#if editing && app.overviewOpen}<LayerOverviewDialog />{/if}
{#if sources.external}<ExternalSourceDialog />{/if}
{#if sources.renderedOpen && sources.rendered}<RenderedConfigurationDialog />{/if}
{#if identify.open && identify.device}<IdentifyDialog />{/if}
{#if app.trial.active}<TrialDialog />{/if}
<ConfirmDialog confirmations={app.confirmations} />
