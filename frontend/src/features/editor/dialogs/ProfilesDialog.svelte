<script lang="ts">
  import Button from "../../../components/Button.svelte";
  import Dialog from "../../../components/Dialog.svelte";
  import { hasDesktopBinding } from "../../../platform/bindings";
  import { useApp } from "../../../state/context";

  // Rename, delete, and move between the profiles of one keyboard.
  const app = useApp();
  const { editor, library, navigation } = app;
  const profile = $derived(editor.profile!);
  // Follows the edited profile's name (so switching resets it) and can be
  // overridden by typing.
  let rename = $derived(profile.name);
  const close = () => (app.profileManagerOpen = false);

  async function submitRename(event: SubmitEvent) {
    event.preventDefault();
    await editor.rename(rename);
  }
</script>

<Dialog labelledby="profiles-title" closeLabel="Close profiles" onclose={close}>
  <p class="eyebrow">PROFILES · {navigation.device?.display_name || "Keyboard"}</p>
  <h2 id="profiles-title">Profiles</h2>
  <p class="dialog-intro">
    Each profile is a separate set of changes for this keyboard. Switching
    profiles applies nothing; use Apply to send one to the keyboard.
  </p>
  <ul class="profile-list" aria-label="Profiles for this keyboard">
    {#each library.forDevice(profile.device_id) as candidate (candidate.id)}
      <li class={[candidate.id === profile.id && "active"]}>
        <div>
          <strong>{candidate.name}</strong>
          <small
            >{candidate.manager_configuration_id
              ? "Applied to keyboard"
              : "Draft only"}</small
          >
        </div>
        {#if candidate.id === profile.id}
          <span class="profile-current">Editing</span>
        {:else}
          <Button
            variant="secondary"
            type="button"
            onclick={() => app.switchProfile(candidate)}
            disabled={library.busy}
            aria-label={`Open ${candidate.name}`}>Open</Button
          >
        {/if}
      </li>
    {/each}
  </ul>
  <form class="behavior-form" onsubmit={submitRename}>
    <label for="profile-rename">Rename this profile</label>
    <input id="profile-rename" bind:value={rename} maxlength="80" required />
    <Button
      variant="secondary"
      type="submit"
      disabled={library.busy || !rename.trim() || rename.trim() === profile.name}
      >Rename profile</Button
    >
  </form>
  <div class="behavior-form-actions">
    <Button
      variant="secondary"
      type="button"
      onclick={() => app.importProfile()}
      disabled={library.busy ||
        !hasDesktopBinding(
          library.pendingFile ? "ImportProfileFromPath" : "ImportProfile",
        )}>{library.pendingFile ? "Import opened file" : "Import"}</Button
    >
    <Button
      variant="secondary"
      type="button"
      onclick={() => app.exportProfile()}
      disabled={library.busy || !hasDesktopBinding("ExportProfile")}>Export</Button
    >
    <Button
      variant="secondary"
      type="button"
      onclick={() => app.newProfile()}
      disabled={library.busy}>New profile</Button
    >
    <Button
      variant="secondary"
      type="button"
      onclick={() => app.duplicateProfile()}
      disabled={library.busy}>Duplicate</Button
    >
    <Button
      variant="secondary"
      class="profile-delete danger"
      type="button"
      onclick={() => app.deleteProfile()}
      disabled={library.busy || !!profile.apply_pending}>Delete profile</Button
    >
  </div>
</Dialog>
