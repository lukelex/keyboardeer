<script lang="ts">
  import Button from "../../components/Button.svelte";
  import { useApp } from "../../state/context";

  // Notices about local profile files: a file the app was launched with, and
  // a profile store that could not be read.
  const app = useApp();
  const library = app.library;
  const fileName = $derived(library.pendingFile.split(/[\\/]/).pop() ?? "");
</script>

{#if library.pendingFile}
  <section
    class="manager-notice"
    data-state="open-profile"
    aria-labelledby="open-profile-title"
  >
    <span class="notice-symbol" aria-hidden="true">↗</span>
    <div>
      <p class="eyebrow">PROFILE FILE</p>
      <h2 id="open-profile-title">A keyboard profile was opened</h2>
      <p>
        KeyboarDeer was started with {fileName}. Open a keyboard in the editor
        and choose Import to load it into that keyboard.
      </p>
      <Button
        variant="secondary"
        type="button"
        onclick={() => library.dismissPendingFile()}>Dismiss</Button
      >
    </div>
  </section>
{/if}
{#if library.storeProblem}
  {@const problem = library.storeProblem}
  <section
    class="manager-notice"
    data-state="profile-store"
    aria-labelledby="profile-store-title"
  >
    <span class="notice-symbol" aria-hidden="true">!</span>
    <div>
      <p class="eyebrow">SAVED DRAFTS</p>
      <h2 id="profile-store-title">
        {problem.state === "unsupported"
          ? "Drafts need a newer KeyboarDeer"
          : "Saved drafts could not be loaded"}
      </h2>
      <p>{problem.message}</p>
      {#if problem.path}<small>File: {problem.path}</small>{/if}
      {#if problem.state === "corrupt"}
        <p>
          Running mappings are unaffected. You can keep the damaged file as a
          backup and start with an empty draft list.
        </p>
        <Button
          variant="primary"
          class="store-recovery"
          type="button"
          onclick={() => app.recoverProfileStore()}>Back up and start fresh</Button
        >
      {/if}
    </div>
  </section>
{/if}
{#if library.recoveryMessage}<p class="inline-feedback" role="status">
    {library.recoveryMessage}
  </p>{/if}
