<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import {
    IdentifyCancel,
    IdentifyOperation,
    IdentifyStart,
    Info,
    Workspace,
    type AppInfo,
    type Capability,
    type Configuration,
    type Device,
    type ManagerStatus,
    type ManagerWorkspace,
    type Operation,
  } from "./desktop";

  type View = "devices" | "identify";
  const initialStatus: ManagerStatus = {
    state: "checking",
    message: "Checking the local manager connection…",
    endpoint: "",
  };

  let info: AppInfo = { name: "KeyboarDeer", version: "starting…" };
  let workspace: ManagerWorkspace = { status: initialStatus };
  let view: View = "devices";
  let selectedDevice: Device | null = null;
  let operation: Operation | null = null;
  let loading = false;
  let identifyBusy = false;
  let feedback = "";
  let pollTimer: ReturnType<typeof setInterval> | undefined;

  const unavailableCapability = (name: string): Capability => ({
    name,
    available: false,
    reason_code: "capability_unknown",
    reason: "The manager has not reported this capability.",
  });
  $: capabilities = workspace.status.capabilities ?? [];
  $: deviceDiscovery =
    capabilities.find((item) => item.name === "device_discovery") ??
    unavailableCapability("device_discovery");
  $: deviceIdentification =
    capabilities.find((item) => item.name === "device_identification") ??
    unavailableCapability("device_identification");
  $: canShowDevices =
    workspace.status.state === "ready" && deviceDiscovery.available;
  $: canIdentify =
    workspace.status.state === "ready" && deviceIdentification.available;
  $: devices = workspace.snapshot?.devices ?? [];
  $: configurations = workspace.snapshot?.configurations ?? [];
  function humanize(value: string) {
    return value
      .replace(/_/g, " ")
      .replace(/\b\w/g, (letter: string) => letter.toUpperCase());
  }
  function isConnected(device: Device) {
    return device.availability === "connected";
  }
  function terminal(state: string) {
    return [
      "succeeded",
      "rejected",
      "failed",
      "rolled_back",
      "cancelled",
    ].includes(state);
  }
  function configurationForDevice(device: Device): Configuration | undefined {
    return configurations.find(
      (configuration) => configuration.device_id === device.id,
    );
  }
  function clearPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = undefined;
  }
  function explain(error: unknown) {
    return error instanceof Error
      ? error.message
      : "The manager did not complete that request.";
  }

  async function refresh() {
    loading = true;
    feedback = "";
    try {
      workspace = await Workspace();
    } catch (error) {
      workspace = {
        status: {
          state: "unavailable",
          message:
            "Desktop bindings are unavailable in this browser preview. Run the Wails app to contact a manager.",
          endpoint: "",
        },
      };
      feedback = explain(error);
    } finally {
      loading = false;
    }
  }

  function openIdentify(device: Device) {
    if (!canIdentify || !isConnected(device)) return;
    selectedDevice = device;
    operation = null;
    feedback = "";
    view = "identify";
  }
  async function pollOperation() {
    if (!operation) return;
    try {
      operation = await IdentifyOperation(operation.id);
      if (operation && terminal(operation.state)) clearPolling();
    } catch (error) {
      feedback = explain(error);
      clearPolling();
    }
  }
  async function startIdentify() {
    if (!selectedDevice || !canIdentify || identifyBusy) return;
    identifyBusy = true;
    feedback = "";
    try {
      operation = await IdentifyStart(selectedDevice.id, 15_000);
      clearPolling();
      pollTimer = setInterval(pollOperation, 700);
    } catch (error) {
      feedback = explain(error);
    } finally {
      identifyBusy = false;
    }
  }
  async function cancelIdentify() {
    if (!operation || terminal(operation.state) || identifyBusy) return;
    identifyBusy = true;
    try {
      operation = await IdentifyCancel(operation.id);
      clearPolling();
    } catch (error) {
      feedback = explain(error);
    } finally {
      identifyBusy = false;
    }
  }
  function backToDevices() {
    clearPolling();
    view = "devices";
    selectedDevice = null;
    operation = null;
  }

  onMount(async () => {
    try {
      info = await Info();
    } catch {
      info = { name: "KeyboarDeer", version: "browser development" };
    }
    await refresh();
  });
  onDestroy(clearPolling);
</script>

<svelte:head><title>{info.name}</title></svelte:head>

<div class="app-shell">
  <header class="app-header">
    <div class="brand">
      <img src="/appicon.png" alt="" width="44" height="44" />
      <span
        ><strong>KeyboarDeer</strong><small
          >A LITTLE WILD. A LITTLE WIRED.</small
        ></span
      >
    </div>
    <div class="header-actions">
      <span
        class:ready={workspace.status.state === "ready"}
        class:attention={workspace.status.state !== "ready"}
        class="connection-status"
      >
        <i></i>{workspace.status.state === "ready"
          ? "Manager ready"
          : humanize(workspace.status.state)}
      </span>
      <button class="button secondary" on:click={refresh} disabled={loading}
        >{loading ? "Checking…" : "Refresh"}</button
      >
    </div>
  </header>

  <main>
    {#if view === "devices"}
      <section aria-labelledby="keyboards-title">
        <div class="page-heading">
          <div>
            <p class="eyebrow">YOUR WORKSPACE</p>
            <h1 id="keyboards-title">Make yourself at home.</h1>
            <p>Your keyboards, ready for a little personal touch.</p>
          </div>
          <span class="build-label">{info.version}</span>
        </div>

        {#if workspace.status.state !== "ready"}
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
                  : "Manager unavailable"}
              </h2>
              <p>{workspace.status.message}</p>
              {#if workspace.status.capability}<small
                  >Required capability: {workspace.status.capability}</small
                >{/if}
              {#if workspace.status.endpoint}<small
                  >Socket: {workspace.status.endpoint}</small
                >{/if}
            </div>
          </section>
        {:else if !deviceDiscovery.available}
          <section
            class="manager-notice"
            data-state="incomplete"
            aria-labelledby="manager-title"
          >
            <span class="notice-symbol" aria-hidden="true">!</span>
            <div>
              <p class="eyebrow">DEVICE INVENTORY UNAVAILABLE</p>
              <h2 id="manager-title">
                The manager has not enabled device discovery.
              </h2>
              <p>{deviceDiscovery.reason}</p>
            </div>
          </section>
        {/if}

        <div class="list-caption">
          <span>YOUR KEYBOARDS</span><span
            >{canShowDevices
              ? `${devices.length} known`
              : "Waiting for manager capability"}</span
          >
        </div>
        {#if canShowDevices && devices.length === 0}
          <section class="empty-state">
            <span aria-hidden="true">⌨</span>
            <h2>A little quiet here.</h2>
            <p>
              The manager has not reported a keyboard yet. Connect one, then
              refresh.
            </p>
          </section>
        {:else if canShowDevices}
          <div class="device-list">
            {#each devices as device (device.id)}
              {@const configuration = configurationForDevice(device)}
              <article class:offline={!isConnected(device)} class="device-card">
                <div class="device-glyph" aria-hidden="true">⌨</div>
                <div class="device-copy">
                  <div class="device-title">
                    <h2>{device.display_name || "Unnamed keyboard"}</h2>
                    <span
                      class:connected={isConnected(device)}
                      class="availability"
                      >{humanize(device.availability || "unknown")}</span
                    >
                  </div>
                  <p>
                    {device.reason ||
                      "The manager did not provide a display explanation."}
                  </p>
                  {#if device.configured_by.length}<small
                      >External configuration: {device.configured_by.join(
                        ", ",
                      )}</small
                    >{/if}
                  {#if configuration}
                    <small
                      >{configuration.ownership} configuration ·
                      {humanize(configuration.runtime.phase)} · desired
                      {configuration.desired_revision} / active
                      {configuration.active_revision}</small
                    >
                  {/if}
                </div>
                <div class="device-actions">
                  <button
                    class="button text"
                    on:click={() => openIdentify(device)}
                    disabled={!canIdentify || !isConnected(device)}
                    title={!canIdentify
                      ? deviceIdentification.reason
                      : !isConnected(device)
                        ? "Identification needs a connected keyboard."
                        : "Identify this keyboard"}>Identify</button
                  >
                  <button
                    class="button primary"
                    disabled
                    title="Visual keyboard drafts are not implemented yet."
                    >Set up</button
                  >
                </div>
              </article>
            {/each}
          </div>
        {:else}
          <section
            class="device-list disabled-list"
            aria-label="Unavailable keyboard inventory"
          >
            <article class="device-card">
              <div class="device-glyph" aria-hidden="true">⌨</div>
              <div class="device-copy">
                <div class="device-title">
                  <h2>Keyboard inventory</h2>
                  <span class="availability">Unavailable</span>
                </div>
                <p>
                  Keyboard actions will become available when the manager
                  reports the required capability.
                </p>
              </div>
              <div class="device-actions">
                <button class="button text" disabled>Identify</button><button
                  class="button primary"
                  disabled>Set up</button
                >
              </div>
            </article>
          </section>
        {/if}
        <p class="boundary-note">
          KeyboarDeer does not inspect input devices or supervise mappings. The
          manager owns those responsibilities.
        </p>
      </section>
    {:else if selectedDevice}
      <section aria-labelledby="identify-title" class="identify-page">
        <button class="back-link" on:click={backToDevices}
          >← All keyboards</button
        >
        <div class="page-heading">
          <div>
            <p class="eyebrow">LET’S FIND YOUR KEYBOARD</p>
            <h1 id="identify-title">Is this the one?</h1>
            <p>A keypress on the selected device confirms the match.</p>
          </div>
          <span class="build-label">ONE BOUNDED SESSION</span>
        </div>
        <article class="identify-card">
          <div class="identify-art" aria-hidden="true">
            <div class="orbit first"></div>
            <div class="orbit second"></div>
            <span>⌨</span>
          </div>
          <div class="identify-copy">
            <p class="eyebrow">{selectedDevice.display_name}</p>
            <h2>
              {operation ? humanize(operation.state) : "Ready when you are."}
            </h2>
            <p>
              {operation?.reason ??
                "Start a 15-second manager session, then press any key on this keyboard. Only the selected mapping may briefly pause."}
            </p>
            <div class="operation-status">
              <i></i><span
                >{operation ? operation.reason_code : "Not started"}</span
              >{#if operation}<small>Operation {operation.id}</small>{/if}
            </div>
            <div class="identify-actions">
              <button
                class="button primary"
                on:click={startIdentify}
                disabled={!canIdentify ||
                  identifyBusy ||
                  !!(operation && !terminal(operation.state))}
                >{identifyBusy
                  ? "Working…"
                  : operation && terminal(operation.state)
                    ? "Try again"
                    : "Start identification"}</button
              ><button
                class="button text"
                on:click={cancelIdentify}
                disabled={!operation ||
                  terminal(operation.state) ||
                  identifyBusy}>Cancel</button
              >
            </div>
          </div>
        </article>
        {#if feedback}<p class="inline-feedback" role="status">
            {feedback}
          </p>{/if}
        <section class="quiet-tip">
          <strong>A brief pause, just for this keyboard.</strong>
          <p>
            The manager owns the session and restores the selected mapping when
            it ends. Other keyboards continue independently.
          </p>
        </section>
      </section>
    {/if}
  </main>
  <footer>
    Draft editing, layers, validation, and applying changes are intentionally
    unavailable until their corresponding implementation milestones are
    complete.
  </footer>
</div>
