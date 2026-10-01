<script lang="ts">
  import Button from "../../components/Button.svelte";
  import { managerGuidance } from "../../domain/devices";
  import { copyText, openExternal } from "../../platform/bindings";
  import { useApp } from "../../state/context";
  import CheckAgainButton from "./CheckAgainButton.svelte";

  // Explains why the keyboard inventory may be missing or out of date.
  const { connection } = useApp();
  const workspace = $derived(connection.workspace);
  const discovery = $derived(connection.capability("device_discovery"));
  const managerURL = "https://github.com/lukelex/kmonad-device-manager";
  // The manager is not reachable at all (not merely missing a capability).
  const unreachable = $derived(
    workspace.status.state === "unavailable" ||
      workspace.status.state === "reconnecting",
  );
  let copied = $state(false);
  async function copyEndpoint() {
    copied = await copyText(workspace.status.endpoint);
  }
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
      <CheckAgainButton />
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
      {#if unreachable}
        <ol class="manager-steps">
          <li>
            Install KMonad Device Manager v1.2.0 or newer
            (<button
              type="button"
              class="inline-link"
              onclick={() => openExternal(managerURL)}
              >installation instructions</button
            >).
          </li>
          <li>Start it for your user account, as its instructions describe.</li>
          <li>
            KeyboarDeer reconnects by itself, or choose Check again.
          </li>
        </ol>
        {#if workspace.status.endpoint}
          <p class="manager-endpoint">
            KeyboarDeer looks for the manager at
            <code>{workspace.status.endpoint}</code>
            <Button variant="text" type="button" onclick={copyEndpoint}
              >{copied ? "Copied" : "Copy path"}</Button
            >
          </p>
        {/if}
      {:else}
        <p class="notice-guidance">{managerGuidance(workspace.status)}</p>
      {/if}
      {#if workspace.status.capability || (workspace.status.endpoint && !unreachable)}
        <details class="technical-details">
          <summary>Technical details</summary>
          {#if workspace.status.capability}<small
              >Required capability: {workspace.status.capability}</small
            >{/if}
          {#if workspace.status.endpoint && !unreachable}<small
              >Socket: {workspace.status.endpoint}</small
            >{/if}
        </details>
      {/if}
      {#if workspace.status.state !== "browser_preview"}<CheckAgainButton />{/if}
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
      <CheckAgainButton />
    </div>
  </section>
{/if}
