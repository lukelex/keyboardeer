<script lang="ts">
  import { managerGuidance } from "../../domain/devices";
  import { useApp } from "../../state/context";

  // Explains why the keyboard inventory may be missing or out of date.
  const { connection } = useApp();
  const workspace = $derived(connection.workspace);
  const discovery = $derived(connection.capability("device_discovery"));
</script>

{#if workspace.stale}
  <section class="manager-notice" data-state="stale" aria-labelledby="manager-title">
    <span class="notice-symbol" aria-hidden="true">!</span>
    <div>
      <p class="eyebrow">LAST KNOWN MANAGER STATE</p>
      <h2 id="manager-title">Keyboard status may be out of date</h2>
      <p>
        {workspace.status.message} KeyboarDeer is showing the last authoritative
        snapshot and will refresh it when the manager is reachable again.
      </p>
      {#if workspace.snapshot_at}<small
          >Last snapshot: {new Date(workspace.snapshot_at).toLocaleString()}</small
        >{/if}
    </div>
  </section>
{:else if workspace.status.state === "checking"}
  <section
    class="manager-notice loading-notice"
    data-state="checking"
    aria-live="polite"
  >
    <span class="notice-symbol" aria-hidden="true">…</span>
    <div>
      <p class="eyebrow">KEYBOARD INVENTORY</p>
      <h2>Loading keyboards</h2>
      <p>Contacting the local manager for the current device snapshot.</p>
    </div>
  </section>
{:else if workspace.status.state !== "ready"}
  <section
    class="manager-notice"
    data-state={workspace.status.state}
    aria-labelledby="manager-title"
  >
    <span class="notice-symbol" aria-hidden="true">!</span>
    <div>
      <p class="eyebrow">MANAGER CONNECTION</p>
      <h2 id="manager-title">
        {workspace.status.state === "incomplete"
          ? "Manager API incomplete"
          : workspace.status.state === "browser_preview"
            ? "Desktop bindings unavailable"
            : "Manager unavailable"}
      </h2>
      <p>{workspace.status.message}</p>
      <p class="notice-guidance">{managerGuidance(workspace.status)}</p>
      {#if workspace.status.capability || workspace.status.endpoint}
        <details class="technical-details">
          <summary>Technical details</summary>
          {#if workspace.status.capability}<small
              >Required capability: {workspace.status.capability}</small
            >{/if}
          {#if workspace.status.endpoint}<small
              >Socket: {workspace.status.endpoint}</small
            >{/if}
        </details>
      {/if}
    </div>
  </section>
{:else if !discovery.available}
  <section
    class="manager-notice"
    data-state="incomplete"
    aria-labelledby="manager-title"
  >
    <span class="notice-symbol" aria-hidden="true">!</span>
    <div>
      <p class="eyebrow">DEVICE INVENTORY UNAVAILABLE</p>
      <h2 id="manager-title">The manager has not enabled device discovery.</h2>
      <p>{discovery.reason}</p>
    </div>
  </section>
{/if}
