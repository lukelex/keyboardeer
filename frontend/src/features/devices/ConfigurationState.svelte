<script lang="ts">
  import Button from "../../components/Button.svelte";
  import { runtimeHealthDetail, runtimeHealthLabel } from "../../domain/devices";
  import { humanize } from "../../domain/text";
  import type { Configuration } from "../../platform/desktop";
  import { useApp } from "../../state/context";

  // One mapping on a keyboard card: a one-line status, with revisions,
  // the latest operation and lifecycle actions behind a disclosure.
  let { configuration }: { configuration: Configuration } = $props();
  const { connection, configurations } = useApp();
  const lastOperation = $derived(connection.operationFor(configuration));
  const managed = $derived(connection.capability("managed_configurations"));
  const name = $derived(configuration.name || "Unnamed configuration");
</script>

<section
  class={[
    "configuration-state",
    !configuration.runtime.healthy && configuration.enabled && "unhealthy",
  ]}
  aria-label={`Configuration ${name}`}
>
  <p class="configuration-summary">
    <i aria-hidden="true"></i>
    <strong>{name}</strong>
    <span>{runtimeHealthLabel(configuration)}</span>
    {#if configuration.ownership === "external"}<span class="configuration-owner"
        >Manager-owned</span
      >{/if}
  </p>
  {#if configuration.enabled && !configuration.runtime.healthy}
    <small>{runtimeHealthDetail(configuration)}</small>
  {/if}
  <details class="configuration-details">
    <summary>Details</summary>
    <dl>
      <div>
        <dt>Desired</dt>
        <dd>{configuration.desired_revision}</dd>
      </div>
      <div>
        <dt>Active</dt>
        <dd>{configuration.active_revision}</dd>
      </div>
      <div>
        <dt>Runtime</dt>
        <dd>{humanize(configuration.runtime.phase)}</dd>
      </div>
    </dl>
    <small>{runtimeHealthDetail(configuration)}</small>
    {#if lastOperation}<small class="configuration-operation"
        >Latest manager operation: {humanize(lastOperation.state)}
        — {lastOperation.reason}</small
      >{/if}
    {#if configuration.ownership === "managed"}
      <div class="configuration-actions">
        <Button
          variant="secondary"
          class="configuration-delete danger"
          type="button"
          onclick={() => configurations.remove(configuration)}
          disabled={!!configurations.busyID || !configurations.canManage}
          title={managed.available
            ? "Stop this mapping and remove it from the manager"
            : managed.reason}
          >{configurations.busyID === configuration.id
            ? "Removing…"
            : "Remove from keyboard"}</Button
        >
      </div>
    {/if}
  </details>
</section>
