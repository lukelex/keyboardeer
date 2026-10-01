<script lang="ts">
  import Button from "../../components/Button.svelte";
  import Menu, { type MenuItem } from "../../components/Menu.svelte";
  import { validationLabel, validationText } from "../../domain/validation";
  import { hasDesktopBinding } from "../../platform/bindings";
  import { useApp } from "../../state/context";

  const app = useApp();
  const { editor, library, sources, navigation } = app;
  const profile = $derived(editor.profile!);
  const busy = $derived(library.busy);

  const saveStatus = $derived(
    editor.saveState === "saving"
      ? "Saving draft…"
      : editor.saveState === "failed"
        ? "Draft not saved"
        : `Draft saved ${new Date(profile.updated_at).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}`,
  );

  const profileItems = $derived<MenuItem[]>([
    ...library.forDevice(profile.device_id).map(
      (candidate): MenuItem => ({
        label: candidate.name,
        hint: candidate.manager_configuration_id ? "Applied to keyboard" : "Draft only",
        checked: candidate.id === profile.id,
        disabled: busy,
        onSelect: () => void app.switchProfile(candidate),
      }),
    ),
    { separator: true },
    { label: "New profile", disabled: busy, onSelect: () => app.newProfile() },
    {
      label: "Duplicate this profile",
      disabled: busy,
      onSelect: () => void app.duplicateProfile(),
    },
    { label: "Rename or delete…", onSelect: () => (app.profileManagerOpen = true) },
  ]);

  const renderedUnavailable = $derived(
    sources.renderedUnavailableReason(profile.manager_configuration_id),
  );
  const moreItems = $derived<MenuItem[]>([
    {
      label: "View .kbd",
      hint: renderedUnavailable,
      disabled:
        !!renderedUnavailable ||
        sources.renderedBusy ||
        !hasDesktopBinding("ExportConfiguration"),
      onSelect: () => void sources.showRendered(profile.manager_configuration_id!),
    },
    {
      label: "Save .kbd…",
      hint: renderedUnavailable,
      disabled:
        !!renderedUnavailable ||
        sources.renderedBusy ||
        !hasDesktopBinding("SaveConfigurationExport"),
      onSelect: () => void sources.saveRendered(profile.manager_configuration_id!),
    },
    { separator: true },
    {
      label: "Export profile…",
      disabled: busy || !hasDesktopBinding("ExportProfile"),
      onSelect: () => void app.exportProfile(),
    },
    {
      label: library.pendingFile ? "Import opened file" : "Import profile…",
      disabled:
        busy ||
        !hasDesktopBinding(
          library.pendingFile ? "ImportProfileFromPath" : "ImportProfile",
        ),
      onSelect: () => void app.importProfile(),
    },
  ]);
</script>

<div class="editor-heading">
  <nav class="editor-nav" aria-label="Editor breadcrumb">
    <Button variant="link" onclick={() => app.backToDevices()}>← All keyboards</Button>
  </nav>
  <div class="editor-title">
    <h1 id="editor-title">
      <Menu
        items={profileItems}
        label="Profiles for this keyboard"
        triggerClass="profile-switcher"
        title="Switch, add, or manage profiles"
        ><span class="profile-switcher-name">{profile.name}</span><span
          class="profile-switcher-chevron"
          aria-hidden="true">▾</span
        ></Menu
      >
    </h1>
    <span>{navigation.device?.display_name ?? "Keyboard"}</span>
  </div>
  <Menu
    items={moreItems}
    label="More profile actions"
    triggerLabel="More profile actions"
    triggerClass="button secondary more-actions"
    title="Export, import, and generated .kbd files">⋯</Menu
  >
  <span class="draft-status" data-state={editor.saveState} role="status"
    >{saveStatus}</span
  >
  <div class="history-actions">
    <Button
      variant="secondary"
      class="history-button"
      type="button"
      onclick={() => editor.undo()}
      disabled={!editor.canUndo}
      aria-label="Undo"
      title="Undo (Ctrl+Z)"
      ><svg class="history-icon" viewBox="0 0 24 24" aria-hidden="true"
        ><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></svg
      ></Button
    >
    <Button
      variant="secondary"
      class="history-button"
      type="button"
      onclick={() => editor.redo()}
      disabled={!editor.canRedo}
      aria-label="Redo"
      title="Redo (Ctrl+Shift+Z)"
      ><svg class="history-icon" viewBox="0 0 24 24" aria-hidden="true"
        ><path d="m15 14 5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></svg
      ></Button
    >
  </div>
  <span
    class="configuration-indicator"
    data-state={editor.validationState}
    role="img"
    aria-label={validationLabel(editor.validationState)}
    title={validationLabel(editor.validationState)}
    ><i></i><span aria-hidden="true">{validationText(editor.validationState)}</span
    ></span
  >
  <Button
    variant="primary"
    class="editor-apply"
    type="button"
    onclick={() => editor.apply.openReview()}
    disabled={!editor.canApply || editor.apply.busy}
    title={editor.canApply
      ? "Apply this validated draft to the keyboard"
      : editor.applyBlockedReason
        ? `Apply unavailable: ${editor.applyBlockedReason}`
        : "Waiting for the manager to check this draft."}
    >{editor.apply.busy ? "Applying…" : "Apply to keyboard"}</Button
  >
</div>
