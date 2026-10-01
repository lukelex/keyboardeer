<script lang="ts">
  import Button from "../../../components/Button.svelte";
  import Dialog from "../../../components/Dialog.svelte";
  import type { ChangeKind } from "../../../domain/applyDiff";
  import { useApp } from "../../../state/context";

  // What a new Apply changes compared with this profile's last Apply.
  const { editor } = useApp();
  const apply = editor.apply;
  const profile = $derived(editor.profile!);
  const keymap = $derived(editor.keymap!);
  const diff = $derived(editor.applyDiff);
  const changeLabels: Record<ChangeKind, string> = {
    added: "Added",
    changed: "Changed",
    removed: "Removed",
  };
</script>

<Dialog
  labelledby="apply-review-title"
  closeLabel="Close apply review"
  onclose={() => apply.closeReview()}
>
  <p class="eyebrow">REVIEW &amp; APPLY</p>
  <h2 id="apply-review-title">Ready to send this draft?</h2>
  {#if apply.reviewNotice}
    <p class="apply-review-notice" role="alert">{apply.reviewNotice}</p>
  {/if}
  {#if profile.applied}
    <p class="dialog-intro">
      Changes since this profile was last applied on {new Date(
        profile.applied.applied_at,
      ).toLocaleString()}. Nothing changes on the keyboard until you confirm.
    </p>
    {#if editor.appliedRevisionDrift}
      <p class="apply-review-notice" role="status">
        The keyboard now runs revision {editor.linkedConfiguration?.active_revision},
        not revision {profile.applied.configuration_revision} from this profile's
        last Apply. Applying replaces it with this draft.
      </p>
    {/if}
  {:else}
    <p class="dialog-intro">
      This is the first Apply of this profile, so everything below will be sent.
      Nothing changes on the keyboard until you confirm.
    </p>
  {/if}
  {#if diff?.count}
    <ul class="apply-review-list" aria-label="Changes to apply">
      {#each diff.layers as change (`layer-${change.id}`)}
        <li data-change={change.kind}>
          <span class="change-kind">{changeLabels[change.kind]}</span>
          <strong>{change.name} layer</strong>
          {#if change.beforeName}<span>Renamed from {change.beforeName}</span>{/if}
        </li>
      {/each}
      {#each diff.declarations as change (`${change.type}-${change.name}`)}
        <li data-change={change.kind}>
          <span class="change-kind">{changeLabels[change.kind]}</span>
          <strong>{change.type === "alias" ? "Alias @" : "Macro #"}{change.name}</strong>
        </li>
      {/each}
      {#each diff.assignments as change (`${change.layerID}-${change.sourceKey}`)}
        <li data-change={change.kind}>
          <span class="change-kind">{changeLabels[change.kind]}</span>
          <strong
            >{keymap.layerName(change.layerID)} · {keymap.catalog.name(
              change.sourceKey,
            )}</strong
          >
          <span
            >{#if change.kind !== "added"}{keymap.describe(
                change.before,
                change.sourceKey,
                change.layerID,
              )}{" → "}{/if}{keymap.describe(
              change.after,
              change.sourceKey,
              change.layerID,
            )}</span
          >
        </li>
      {/each}
    </ul>
  {:else}
    <p class="apply-review-empty">
      {profile.applied
        ? "No changes since the last Apply. Applying again re-sends the same mapping."
        : "No explicit assignments; the original Base layout will be applied."}
    </p>
  {/if}
  <div class="behavior-form-actions">
    <Button variant="secondary" type="button" onclick={() => apply.closeReview()}
      >Keep editing</Button
    >
    <Button
      variant="primary"
      type="button"
      onclick={() => apply.confirm()}
      disabled={!editor.canApply || apply.busy}
      title={editor.canApply
        ? "Send this draft to the keyboard"
        : "Waiting for a current valid preview of the refreshed keyboard state."}
      >Apply to keyboard</Button
    >
  </div>
</Dialog>
