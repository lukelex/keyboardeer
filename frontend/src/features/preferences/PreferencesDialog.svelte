<script lang="ts">
  import Button from "../../components/Button.svelte";
  import Dialog from "../../components/Dialog.svelte";
  import { useApp } from "../../state/context";
  import type { Theme } from "../../state/navigation.svelte";

  const app = useApp();
  const preferences = app.preferences;
  const themes: [Theme, string][] = [
    ["system", "Match system"],
    ["light", "Light"],
    ["dark", "Dark"],
  ];
</script>

<Dialog
  labelledby="preferences-title"
  class="behavior-dialog preferences-dialog"
  closeLabel="Close preferences"
  closeOnBackdrop
  onclose={() => preferences.close()}
>
  <p class="eyebrow">MAKE IT YOURS</p>
  <h2 id="preferences-title">Preferences</h2>
  <p class="dialog-intro">
    Choose where KeyboarDeer keeps your editable keyboard profiles.
  </p>
  <fieldset class="preference-setting appearance-setting">
    <legend>Appearance</legend>
    <div class="segmented" role="radiogroup" aria-label="Appearance">
      {#each themes as [value, label] (value)}
        <label class={[app.theme === value && "selected"]}
          ><input
            type="radio"
            name="theme"
            {value}
            checked={app.theme === value}
            onchange={() => app.setTheme(value)}
          />{label}</label
        >
      {/each}
    </div>
    <small>Applies right away, on this computer.</small>
  </fieldset>
  <div class="preference-setting">
    <label class="preference-toggle"
      ><input type="checkbox" bind:checked={preferences.syncEnabled} /><span
        ><strong>Sync profiles to a folder</strong><small
          >Save editable profile JSON here so your existing sync service or Git
          can keep it in sync.</small
        ></span
      ></label
    >
    {#if preferences.syncEnabled}
      <div class="preference-folder">
        <label for="profile-sync-folder">Profile folder</label>
        <div class="preference-folder-row">
          <input
            id="profile-sync-folder"
            value={preferences.folder}
            readonly
            placeholder="Choose a folder"
          /><Button variant="secondary" onclick={() => preferences.chooseFolder()}
            >Choose folder</Button
          >
        </div>
        <p>Profile JSON is kept here. Generated .kbd files are separate.</p>
      </div>
    {/if}
  </div>
  <div class="preference-note">
    <strong>Your files stay yours.</strong><span
      >KeyboarDeer writes profile files in this folder; it does not interact
      with Git.</span
    >
  </div>
  <section class="preference-about" aria-labelledby="about-title">
    <h3 id="about-title">About KeyboarDeer</h3>
    <p class="preference-version">Version {app.info.version}</p>
    <p>
      KeyboarDeer edits your keyboard profiles; they are the source of truth,
      and the KMonad configuration is generated from them. The separate
      kmonad-device-manager service finds keyboards, checks and applies
      configurations, and keeps them running, even when this app is closed.
    </p>
  </section>
  {#if preferences.notice}<p class="preference-error" role="alert">
      {preferences.notice}
    </p>{/if}
  <div class="dialog-actions">
    <Button variant="secondary" onclick={() => preferences.close()}>Cancel</Button
    ><Button
      variant="primary"
      disabled={preferences.busy}
      onclick={() => preferences.save()}
      >{preferences.busy ? "Saving…" : "Save preferences"}</Button
    >
  </div>
</Dialog>
