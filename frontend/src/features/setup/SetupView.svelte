<script lang="ts">
  import Button from "../../components/Button.svelte";
  import KeyboardPreview from "../../components/KeyboardPreview.svelte";
  import { isConnected, scanMatchDescription } from "../../domain/devices";
  import { useApp } from "../../state/context";

  const app = useApp();
  const { setup, library } = app;
  const connected = $derived(!!setup.device && isConnected(setup.device));

  function submit(event: SubmitEvent) {
    event.preventDefault();
    void app.createProfileFromSetup();
  }
</script>

<section class="setup-page" aria-labelledby="setup-title">
  <Button variant="link" onclick={() => app.backToDevices()}>← All keyboards</Button>
  <div class="page-heading">
    <div>
      <p class="eyebrow">A FRESH START</p>
      <h1 id="setup-title">Meet your keyboard.</h1>
      <p>Create a local draft. Nothing changes on the keyboard yet.</p>
    </div>
    <span class="build-label">LOCAL DRAFT</span>
  </div>
  <form class="setup-card" onsubmit={submit}>
    <label for="profile-name">Profile name</label>
    <input id="profile-name" bind:value={setup.name} maxlength="80" required />
    <label for="geometry">Physical layout</label>
    <select
      id="geometry"
      value={setup.geometryID}
      onchange={(event) => setup.chooseGeometry(event.currentTarget.value)}
      required
    >
      {#if !setup.geometryID}
        <option value="" disabled selected>Choose a layout</option>
      {/if}
      {#each library.geometries as geometry (geometry.id)}
        <option value={geometry.id}>{geometry.name}</option>
      {/each}
    </select>
    {#if setup.geometry}
      <div class="setup-layout-preview">
        <KeyboardPreview geometry={setup.geometry} />
      </div>
      <p class="field-help">{setup.geometry.description}</p>
    {/if}
    <div class="layout-detection" aria-live="polite">
      {#if setup.scanning}
        <p class="field-help" role="status">
          Checking which keys this keyboard reports…
        </p>
      {:else if setup.detectedExactly}
        <p class="layout-detected" role="status">
          ✓ Detected: this keyboard reports exactly the keys of {setup.geometry
            ?.name}.
        </p>
      {/if}
      {#if setup.scan && setup.matches.length}
        <p class="eyebrow">VERIFIED CANDIDATES</p>
        <div class="layout-candidates">
          {#each setup.candidates as match (match.geometry_id)}
            {@const selected = match.geometry_id === setup.geometryID}
            <button
              class={["layout-candidate", selected && "selected"]}
              type="button"
              aria-pressed={selected}
              onclick={() => setup.chooseMatch(match)}
            >
              <span>
                <strong>{match.name}</strong>
                <small>{scanMatchDescription(match)}</small>
              </span>
              <span>{selected ? "Selected" : "Choose"}</span>
            </button>
          {/each}
        </div>
      {/if}
      {#if setup.notice}<p class="inline-feedback" role="status">
          {setup.notice}
        </p>{/if}
      {#if setup.canDetect}
        <Button
          variant="text"
          type="button"
          class="layout-detect-again"
          onclick={() => setup.detect()}
          disabled={setup.scanning || !connected}
          title={connected
            ? "Ask the manager which keys this keyboard reports"
            : "Connect the keyboard to detect its layout"}
          >{setup.scan ? "Detect again" : "Detect layout"}</Button
        >
      {:else}
        <p class="field-help">
          Layout detection needs the desktop app's manager connection.
        </p>
      {/if}
    </div>
    <p class="boundary-note">
      KeyboarDeer suggests a layout only from the keys the manager reports,
      never from the keyboard's name, and you confirm it by creating the
      profile.
    </p>
    <div class="setup-actions">
      <Button variant="secondary" type="button" onclick={() => app.backToDevices()}
        >Cancel</Button
      >
      <Button
        variant="primary"
        type="submit"
        disabled={library.busy || !setup.geometryID}
        >{library.busy ? "Creating…" : "Create draft"}</Button
      >
    </div>
  </form>
</section>
