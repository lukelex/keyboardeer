<script lang="ts">
  import Button from "../../components/Button.svelte";
  import { runtimeHealthLabel } from "../../domain/devices";
  import { applyOutcomeDetail, applyOutcomeTitle } from "../../domain/operations";
  import { humanize } from "../../domain/text";
  import { useApp } from "../../state/context";

  // The latest Apply for this profile, and recovery when its outcome is not
  // yet known. Manager internals stay under "Technical details".
  const { editor } = useApp();
  const profile = $derived(editor.profile!);
  const pending = $derived(profile.apply_pending);
  const outcome = $derived(editor.applyOutcome);
  const linked = $derived(editor.linkedConfiguration);
  const apply = editor.apply;
</script>

{#if pending?.idempotency_supported || pending?.operation_id}
  <div class="apply-status apply-pending" role="status">
    {#if pending.operation_id}
      <p>
        The manager accepted this apply. KeyboarDeer is tracking its final
        outcome; closing the app will not cancel the manager's work.
      </p>
    {:else}
      <p>
        The manager has not confirmed the Apply sent at {new Date(
          pending.started_at,
        ).toLocaleString()}. KeyboarDeer kept the exact request and can safely
        check again without applying it twice.
      </p>
    {/if}
    <Button
      variant="secondary"
      type="button"
      onclick={() => apply.checkPending()}
      disabled={apply.busy}>{apply.busy ? "Checking…" : "Check apply outcome"}</Button
    >
    {#if pending.operation_id}
      <Button
        variant="secondary"
        class="legacy-discard"
        type="button"
        onclick={() => apply.discardPending()}
        disabled={apply.busy}>I checked the keyboard — clear unresolved apply</Button
      >
    {/if}
  </div>
{:else if pending}
  <p class="apply-status">
    An Apply sent at {new Date(pending.started_at).toLocaleString()} has an unknown
    outcome. The manager version that received it does not guarantee durable
    idempotency, so KeyboarDeer will not replay it. Check the keyboard card before
    continuing.
  </p>
  <Button
    variant="secondary"
    class="legacy-discard"
    type="button"
    onclick={() => apply.discardPending()}
    >I checked the keyboard — continue editing</Button
  >
{:else if outcome}
  <div class="apply-status apply-outcome" data-state={outcome.state} role="status">
    <p>
      <strong>{applyOutcomeTitle(outcome)}</strong>
      {applyOutcomeDetail(outcome)}
      {#if outcome.state === "succeeded" && profile.applied && editor.applyDiff?.count}
        Edits made since then are not applied yet.
      {/if}
    </p>
    <details class="technical-details">
      <summary>Technical details</summary>
      <p>Manager Apply: {humanize(outcome.state)} — {outcome.reason}</p>
      {#if linked}
        <p class="active-revision">
          Manager-reported active revision:
          {linked.active_revision || "none"} · desired revision
          {linked.desired_revision} · runtime:
          {runtimeHealthLabel(linked).toLowerCase()}.
        </p>
      {/if}
      {#if outcome.id}<p>Operation {outcome.id}</p>{/if}
    </details>
  </div>
{/if}
