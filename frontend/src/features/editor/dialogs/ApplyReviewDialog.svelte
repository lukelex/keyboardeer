<script lang="ts">
  import Button from "../../../components/Button.svelte";
  import Dialog from "../../../components/Dialog.svelte";
  import { useApp } from "../../../state/context";
  import ChangeList from "../ChangeList.svelte";

  // What a new Apply changes compared with this profile's last Apply.
  const { editor } = useApp();
  const apply = editor.apply;
  const profile = $derived(editor.profile!);
  const keymap = $derived(editor.keymap!);
  const diff = $derived(editor.applyDiff);
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
    <ChangeList diff={diff} {keymap} label="Changes to apply" />
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
