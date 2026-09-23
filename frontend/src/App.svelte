<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import {
    ApplyProfile,
    CreateProfile,
    Geometries,
    IdentifyCancel,
    IdentifyOperation,
    IdentifyStart,
    Info,
    PreviewProfile,
    Profiles,
    SaveProfile,
    Workspace,
    type AppInfo,
    type Capability,
    type Configuration,
    type Device,
    type GeometryTemplate,
    type ManagerStatus,
    type ManagerWorkspace,
    type Operation,
    type Profile,
    type ProfileApplyResult,
    type ProfileBehavior,
    type ProfilePreview,
  } from "./desktop";

  type View = "devices" | "identify" | "setup" | "editor" | "review";
  const initialStatus: ManagerStatus = {
    state: "checking",
    message: "Checking the local manager connection…",
    endpoint: "",
  };

  let info: AppInfo = { name: "KeyboarDeer", version: "starting…" };
  let workspace: ManagerWorkspace = { status: initialStatus };
  let view: View = "devices";
  let selectedDevice: Device | null = null;
  let profiles: Profile[] = [];
  let geometries: GeometryTemplate[] = [];
  let selectedGeometryID = "";
  let profileName = "";
  let activeProfile: Profile | null = null;
  let selectedSourceKey = "";
  let profileBusy = false;
  let previewBusy = false;
  let profilePreview: ProfilePreview | null = null;
  let previewTimer: ReturnType<typeof setTimeout> | undefined;
  let previewGeneration = 0;
  let applyBusy = false;
  let applyConfirmed = false;
  let applyOperation: Operation | null = null;
  let operation: Operation | null = null;
  let loading = false;
  let identifyBusy = false;
  let feedback = "";
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let stopWorkspaceEvents: (() => void) | undefined;

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
  $: managedConfigurations =
    capabilities.find((item) => item.name === "managed_configurations") ??
    unavailableCapability("managed_configurations");
  $: activeGeometry = activeProfile
    ? geometries.find((geometry) => geometry.id === activeProfile?.geometry.id)
    : undefined;
  // Basic remapping deliberately offers every explicitly verified source key
  // in the selected geometry. It never guesses a larger physical layout or
  // presents unverified KMonad key aliases as editor options.
  $: basicKeyOptions = activeGeometry?.keys ?? [];
  $: currentPreview =
    activeProfile &&
    profilePreview?.profile_id === activeProfile.id &&
    profilePreview.draft_revision === activeProfile.draft_revision &&
    profilePreview.manager_server_id === workspace.status.server_id
      ? profilePreview
      : null;
  $: canApply =
    !!activeProfile &&
    workspace.status.state === "ready" &&
    managedConfigurations.available &&
    !!selectedDevice &&
    isConnected(selectedDevice) &&
    !selectedDevice?.runtime_conflict &&
    currentPreview?.validation.outcome === "valid" &&
    !activeProfile.apply_pending;
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
  function profileForDevice(device: Device): Profile | undefined {
    return profiles.find((profile) => profile.device_id === device.id);
  }
  function behaviorFor(sourceKey: string): ProfileBehavior | undefined {
    return activeProfile?.assignments?.find(
      (assignment) =>
        assignment.layer_id === "base" && assignment.source_key === sourceKey,
    )?.behavior;
  }
  function behaviorLabel(
    behavior: ProfileBehavior | undefined,
    sourceKey: string,
  ) {
    if (!behavior) return sourceKey;
    if (behavior.kind === "key") return behavior.key ?? sourceKey;
    if (behavior.kind === "transparent") return "Pass through";
    if (behavior.kind === "disabled") return "Disabled";
    return humanize(behavior.kind);
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
  function isWorkspace(value: unknown): value is ManagerWorkspace {
    return typeof value === "object" && value !== null && "status" in value;
  }
  function hasDesktopBinding(name: string) {
    return !!window.go?.main?.App?.[name as keyof typeof window.go.main.App];
  }
  async function waitForDesktopBinding(name: string, timeoutMS = 1500) {
    const deadline = Date.now() + timeoutMS;
    while (!hasDesktopBinding(name) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return hasDesktopBinding(name);
  }

  async function refresh() {
    loading = true;
    feedback = "";
    const workspaceBindingReady = await waitForDesktopBinding("Workspace");
    try {
      workspace = await Workspace();
      if (workspaceBindingReady) void loadLocalDrafts();
    } catch (error) {
      const desktopUnavailable = !workspaceBindingReady;
      workspace = {
        status: {
          state: desktopUnavailable ? "browser_preview" : "unavailable",
          message: desktopUnavailable
            ? "This browser preview has no Wails desktop bindings, so it cannot contact the local manager. Use the native KeyboarDeer window launched by scripts/desktop.sh."
            : `The desktop app could not load the manager workspace: ${explain(error)}`,
          endpoint: "",
        },
      };
      feedback = explain(error);
    } finally {
      loading = false;
    }
  }
  async function loadLocalDrafts() {
    try {
      [profiles, geometries] = await Promise.all([Profiles(), Geometries()]);
      selectedGeometryID ||= geometries[0]?.id ?? "";
    } catch {
      // Browser preview deliberately has no desktop persistence bindings.
    }
  }

  function openIdentify(device: Device) {
    if (!canIdentify || !isConnected(device)) return;
    selectedDevice = device;
    operation = null;
    feedback = "";
    view = "identify";
  }
  function openDraft(device: Device) {
    if (!canShowDevices) return;
    selectedDevice = device;
    feedback = "";
    profilePreview = null;
    const draft = profileForDevice(device);
    if (draft) {
      activeProfile = draft;
      selectedSourceKey = draft.geometry.source_keys[0] ?? "";
      view = "editor";
      return;
    }
    activeProfile = null;
    profileName = device.display_name
      ? `${device.display_name} draft`
      : "Keyboard draft";
    selectedGeometryID ||= geometries[0]?.id ?? "";
    view = "setup";
  }
  async function createDraft() {
    if (
      !selectedDevice ||
      !selectedGeometryID ||
      !profileName.trim() ||
      profileBusy
    )
      return;
    profileBusy = true;
    feedback = "";
    try {
      activeProfile = await CreateProfile(
        selectedDevice.id,
        profileName.trim(),
        selectedGeometryID,
      );
      profiles = [...profiles, activeProfile];
      selectedSourceKey = activeProfile.geometry.source_keys[0] ?? "";
      view = "editor";
      schedulePreview(activeProfile);
    } catch (error) {
      feedback = explain(error);
    } finally {
      profileBusy = false;
    }
  }
  async function assignBaseBehavior(behavior: ProfileBehavior) {
    if (!activeProfile || !selectedSourceKey || profileBusy) return;
    profileBusy = true;
    feedback = "";
    profilePreview = null;
    const assignments = (activeProfile.assignments ?? []).filter(
      (assignment) =>
        assignment.layer_id !== "base" ||
        assignment.source_key !== selectedSourceKey,
    );
    assignments.push({
      layer_id: "base",
      source_key: selectedSourceKey,
      behavior,
    });
    try {
      const saved = await SaveProfile({ ...activeProfile, assignments });
      activeProfile = saved;
      profiles = profiles.map((profile) =>
        profile.id === saved.id ? saved : profile,
      );
      schedulePreview(saved);
    } catch (error) {
      feedback = explain(error);
    } finally {
      profileBusy = false;
    }
  }
  function schedulePreview(draft: Profile) {
    if (previewTimer) clearTimeout(previewTimer);
    const generation = ++previewGeneration;
    previewBusy = true;
    previewTimer = setTimeout(() => {
      previewTimer = undefined;
      void previewDraft(draft, generation);
    }, 250);
  }
  function openReview() {
    if (!canApply || !activeProfile) return;
    applyConfirmed = false;
    applyOperation = null;
    feedback = "";
    view = "review";
  }
  async function applyDraft() {
    if (!activeProfile || !canApply || !applyConfirmed || applyBusy) return;
    applyBusy = true;
    feedback = "";
    try {
      const result: ProfileApplyResult = await ApplyProfile(activeProfile.id);
      activeProfile = result.profile;
      profiles = profiles.map((profile) =>
        profile.id === result.profile.id ? result.profile : profile,
      );
      applyOperation = result.operation;
      view = "editor";
      await refresh();
    } catch (error) {
      feedback = explain(error);
    } finally {
      applyBusy = false;
    }
  }
  async function previewDraft(draft: Profile, generation: number) {
    if (
      !capabilities.find(
        (capability) => capability.name === "candidate_validation",
      )?.available
    ) {
      if (generation === previewGeneration) previewBusy = false;
      return;
    }
    try {
      const result = await PreviewProfile(draft.id);
      if (
        activeProfile?.id === result.profile_id &&
        activeProfile.draft_revision === result.draft_revision
      ) {
        profilePreview = result;
      }
    } catch (error) {
      if (
        activeProfile?.id === draft.id &&
        activeProfile.draft_revision === draft.draft_revision
      ) {
        feedback = explain(error);
      }
    } finally {
      if (generation === previewGeneration) previewBusy = false;
    }
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
    activeProfile = null;
    profilePreview = null;
    applyOperation = null;
  }

  onMount(() => {
    void (async () => {
      try {
        await waitForDesktopBinding("Info");
        info = await Info();
      } catch {
        info = { name: "KeyboarDeer", version: "browser development" };
      }
    })();
    stopWorkspaceEvents = window.runtime?.EventsOn?.(
      "workspace:changed",
      (next) => {
        if (isWorkspace(next)) workspace = next;
      },
    );
    // The manager view must never wait on optional local-draft bindings. A
    // corrupt or unavailable profile store may disable setup, but it cannot
    // leave the device workspace indefinitely stuck in its initial state.
    void refresh();
  });
  onDestroy(() => {
    clearPolling();
    if (previewTimer) clearTimeout(previewTimer);
    stopWorkspaceEvents?.();
  });
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
                  : workspace.status.state === "browser_preview"
                    ? "Desktop bindings unavailable"
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
                  {#if device.configured_by?.length}<small
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
                    on:click={() => openDraft(device)}
                    disabled={!canShowDevices || geometries.length === 0}
                    title={geometries.length === 0
                      ? "Loading verified keyboard geometries."
                      : profileForDevice(device)
                        ? "Open this local keyboard draft"
                        : "Create a local keyboard draft"}
                    >{profileForDevice(device)
                      ? "Edit draft"
                      : "Set up"}</button
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
    {:else if view === "identify" && selectedDevice}
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
    {:else if view === "setup" && selectedDevice}
      <section class="setup-page" aria-labelledby="setup-title">
        <button class="back-link" on:click={backToDevices}
          >← All keyboards</button
        >
        <div class="page-heading">
          <div>
            <p class="eyebrow">A FRESH START</p>
            <h1 id="setup-title">Meet your keyboard.</h1>
            <p>Create a local draft. Nothing changes on the keyboard yet.</p>
          </div>
          <span class="build-label">LOCAL DRAFT</span>
        </div>
        <form class="setup-card" on:submit|preventDefault={createDraft}>
          <label for="profile-name">Draft name</label>
          <input
            id="profile-name"
            bind:value={profileName}
            maxlength="80"
            required
          />
          <label for="geometry">Physical layout</label>
          <select id="geometry" bind:value={selectedGeometryID} required>
            {#each geometries as geometry (geometry.id)}
              <option value={geometry.id}>{geometry.name}</option>
            {/each}
          </select>
          {#if geometries.find((geometry) => geometry.id === selectedGeometryID)}
            <p class="field-help">
              {geometries.find((geometry) => geometry.id === selectedGeometryID)
                ?.description}
            </p>
          {/if}
          <p class="boundary-note">
            Layout selection is explicit. KeyboarDeer does not guess a physical
            layout from the keyboard’s name.
          </p>
          <div class="setup-actions">
            <button
              class="button secondary"
              type="button"
              on:click={backToDevices}>Cancel</button
            >
            <button
              class="button primary"
              type="submit"
              disabled={profileBusy || !selectedGeometryID}
              >{profileBusy ? "Creating…" : "Create draft"}</button
            >
          </div>
        </form>
        {#if feedback}<p class="inline-feedback" role="status">
            {feedback}
          </p>{/if}
      </section>
    {:else if view === "editor" && activeProfile}
      <section class="editor-page" aria-labelledby="editor-title">
        <button class="back-link" on:click={backToDevices}
          >← All keyboards</button
        >
        <div class="page-heading">
          <div>
            <p class="eyebrow">{selectedDevice?.display_name ?? "KEYBOARD"}</p>
            <h1 id="editor-title">{activeProfile.name}</h1>
            <p>
              Base layer · saved locally · revision {activeProfile.draft_revision}
            </p>
          </div>
          <span class="build-label"
            >{activeProfile.manager_configuration_id
              ? "MANAGED PROFILE"
              : "DRAFT ONLY"}</span
          >
        </div>
        {#if activeGeometry}
          <div class="keyboard-editor" aria-label={activeGeometry.name}>
            {#each [0, 1, 2, 3, 4] as row}
              <div class="keyboard-row">
                {#each activeGeometry.keys.filter((key) => key.row === row) as key (key.id)}
                  <button
                    class:selected-key={selectedSourceKey === key.source_key}
                    class="editor-key"
                    style={`--key-width: ${key.width}`}
                    on:click={() => (selectedSourceKey = key.source_key)}
                    aria-pressed={selectedSourceKey === key.source_key}
                  >
                    <strong>{key.label}</strong><small
                      >{behaviorLabel(
                        behaviorFor(key.source_key),
                        key.source_key,
                      )}</small
                    >
                  </button>
                {/each}
              </div>
            {/each}
          </div>
          <section class="key-palette" aria-label="Basic key assignments">
            <div>
              <p class="eyebrow">SELECTED KEY</p>
              <h2>
                {activeGeometry.keys.find(
                  (key) => key.source_key === selectedSourceKey,
                )?.label ?? selectedSourceKey}
              </h2>
              <p>
                Choose a basic behavior for the Base layer. All
                {basicKeyOptions.length} keys in this verified layout are available
                below.
              </p>
            </div>
            <div class="palette-buttons">
              {#each basicKeyOptions as key (key.id)}
                <button
                  class="button secondary"
                  on:click={() =>
                    assignBaseBehavior({ kind: "key", key: key.source_key })}
                  disabled={profileBusy}
                  title={`Assign ${key.label} (${key.source_key})`}
                  ><span>{key.label}</span><small>{key.source_key}</small
                  ></button
                >
              {/each}
              <button
                class="button secondary"
                on:click={() => assignBaseBehavior({ kind: "disabled" })}
                disabled={profileBusy}>Disable</button
              >
            </div>
          </section>
          <section
            class:rejected={currentPreview?.validation.outcome === "rejected"}
            class="preview-status"
            aria-live="polite"
          >
            <strong
              >{previewBusy
                ? "Checking complete draft…"
                : currentPreview
                  ? `Manager preview: ${humanize(currentPreview.validation.outcome)}`
                  : "Preview not checked"}</strong
            >
            <p>
              {currentPreview?.validation.reason ??
                "Every semantic edit is checked against the complete compiled draft."}
            </p>
            {#if currentPreview?.validation.outcome === "rejected"}
              <p>
                No keyboard mapping has been applied. The manager did not
                provide a reliable key location for this result.
              </p>
            {/if}
            {#if activeProfile.apply_pending}
              <p>
                An Apply sent at {new Date(
                  activeProfile.apply_pending.started_at,
                ).toLocaleString()} has an unknown outcome. To prevent a duplicate
                configuration, KeyboarDeer will not retry it automatically.
              </p>
            {:else if applyOperation}
              <p>
                Manager Apply: {humanize(applyOperation.state)} —
                {applyOperation.reason}
              </p>
            {/if}
          </section>
          <div class="apply-actions">
            <div>
              <p class="eyebrow">MANAGED APPLY</p>
              <p>
                The manager will render, validate, persist, and supervise this
                profile. It owns all device and KMonad lifecycle work.
              </p>
            </div>
            <button
              class="button primary"
              type="button"
              on:click={openReview}
              disabled={!canApply || applyBusy}
              title={canApply
                ? "Review the validated draft before applying it"
                : "Apply requires a current valid manager preview, a connected keyboard, and the managed-configurations capability."}
              >Review & apply</button
            >
          </div>
        {:else}
          <section class="manager-notice" data-state="incomplete">
            <span class="notice-symbol" aria-hidden="true">!</span>
            <div>
              <h2>Geometry unavailable</h2>
              <p>This draft refers to a geometry this version cannot render.</p>
            </div>
          </section>
        {/if}
        {#if feedback}<p class="inline-feedback" role="status">
            {feedback}
          </p>{/if}
      </section>
    {:else if view === "review" && activeProfile}
      <section class="review-page" aria-labelledby="review-title">
        <button class="back-link" on:click={() => (view = "editor")}
          >← Back to editor</button
        >
        <div class="page-heading">
          <div>
            <p class="eyebrow">REVIEW & APPLY</p>
            <h1 id="review-title">Ready to make it live?</h1>
            <p>
              {activeProfile.name} will be managed for
              {selectedDevice?.display_name ?? "this keyboard"}.
            </p>
          </div>
          <span class="build-label">VALIDATED DRAFT</span>
        </div>
        <section class="review-card">
          <h2>What happens next</h2>
          <ol>
            <li>The manager recompiles and validates the complete behavior.</li>
            <li>It writes its own managed configuration and activates it.</li>
            <li>
              It reports activation or rollback; closing this app does not stop
              the mapping.
            </li>
          </ol>
          <p class="boundary-note">
            This is a {activeProfile.manager_configuration_id
              ? "revision-checked update"
              : "new managed configuration"}. The manager, not KeyboarDeer,
            chooses all platform input and output details.
          </p>
          <label class="apply-confirmation">
            <input
              type="checkbox"
              bind:checked={applyConfirmed}
              disabled={applyBusy}
            />
            <span
              >I understand this changes the live mapping for this keyboard.</span
            >
          </label>
          <div class="setup-actions">
            <button
              class="button secondary"
              type="button"
              on:click={() => (view = "editor")}
              disabled={applyBusy}>Cancel</button
            >
            <button
              class="button primary"
              type="button"
              on:click={applyDraft}
              disabled={!applyConfirmed || !canApply || applyBusy}
              >{applyBusy ? "Applying…" : "Apply to keyboard"}</button
            >
          </div>
        </section>
        {#if feedback}<p class="inline-feedback" role="status">
            {feedback}
          </p>{/if}
      </section>
    {/if}
  </main>
  <footer>
    Drafts remain your source of truth; the manager owns generated runtime
    configurations.
  </footer>
</div>
