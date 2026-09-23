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
    SetConfigurationEnabled,
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

  type View = "devices" | "setup" | "editor";
  type KeyOption = GeometryTemplate["keys"][number];
  type ComplexAction = "tap_hold" | "layer" | "alias" | "macro";
  const managerCheckIntervalMS = 15_000;
  const modifierSourceKeys = new Set([
    "caps",
    "cmp",
    "lalt",
    "lctl",
    "lmet",
    "lsft",
    "ralt",
    "rctl",
    "rmet",
    "rsft",
  ]);
  const browserCodeToSourceKey: Record<string, string> = {
    Escape: "esc",
    Backquote: "grv",
    Minus: "-",
    Equal: "=",
    Backspace: "bspc",
    Tab: "tab",
    BracketLeft: "[",
    BracketRight: "]",
    Backslash: "\\",
    CapsLock: "caps",
    Semicolon: ";",
    Quote: "'",
    Enter: "ret",
    ShiftLeft: "lsft",
    ShiftRight: "rsft",
    Comma: ",",
    Period: ".",
    Slash: "/",
    ControlLeft: "lctl",
    ControlRight: "rctl",
    MetaLeft: "lmet",
    MetaRight: "rmet",
    AltLeft: "lalt",
    AltRight: "ralt",
    Space: "spc",
    ContextMenu: "cmp",
    PrintScreen: "prnt",
    Pause: "pause",
    Insert: "ins",
    Delete: "del",
    Home: "home",
    End: "end",
    PageUp: "pgup",
    PageDown: "pgdn",
    ArrowUp: "up",
    ArrowDown: "down",
    ArrowLeft: "left",
    ArrowRight: "rght",
  };
  for (let digit = 0; digit <= 9; digit += 1) {
    browserCodeToSourceKey[`Digit${digit}`] = String(digit);
  }
  for (let letter = 65; letter <= 90; letter += 1) {
    const key = String.fromCharCode(letter);
    browserCodeToSourceKey[`Key${key}`] = key.toLowerCase();
  }
  for (let functionKey = 1; functionKey <= 12; functionKey += 1) {
    browserCodeToSourceKey[`F${functionKey}`] = `f${functionKey}`;
  }
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
  let selectedLayerID = "base";
  let behaviorDialog: ComplexAction | null = null;
  let tapKey = "";
  let tapHoldMode: "key" | "layer" = "key";
  let holdKey = "";
  let tapHoldLayerID = "base";
  let tapHoldTimeoutMS = 200;
  let layerAction: "hold_layer" | "switch_layer" = "hold_layer";
  let layerTargetID = "base";
  let newLayerName = "";
  let aliasName = "";
  let aliasKey = "";
  let macroName = "";
  let macroNextKey = "";
  let macroSteps: string[] = [];
  let flashingSourceKey = "";
  let keyFlashTimer: ReturnType<typeof setTimeout> | undefined;
  let profileBusy = false;
  let previewBusy = false;
  let profilePreview: ProfilePreview | null = null;
  let previewTimer: ReturnType<typeof setTimeout> | undefined;
  let previewGeneration = 0;
  let applyBusy = false;
  let applyOperation: Operation | null = null;
  let lifecycleBusyID = "";
  let operation: Operation | null = null;
  let loading = false;
  let identifyBusy = false;
  let identifyOpen = false;
  let feedback = "";
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let managerCheckTimer: ReturnType<typeof setInterval> | undefined;
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
  // Device roles are manager-owned semantics. Keep an absent role visible for
  // compatibility with older managers, but never configure an explicit
  // non-input role.
  $: visibleBoards = devices.filter(
    (device) => device.role === undefined || device.role === "input",
  );
  $: configurations = workspace.snapshot?.configurations ?? [];
  $: setUpBoards = visibleBoards.filter(
    (device) =>
      profiles.some((profile) => profile.device_id === device.id) ||
      configurations.some(
        (configuration) =>
          configuration.device_id === device.id &&
          configuration.ownership === "managed",
      ),
  );
  $: unconfiguredBoards = visibleBoards.filter(
    (device) => !setUpBoards.some((setUpDevice) => setUpDevice.id === device.id),
  );
  $: sortedBoards = [...setUpBoards, ...unconfiguredBoards];
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
  // The palette is an action catalog, not another representation of the
  // physical layout. Repeated source codes (for example on a split board)
  // therefore appear once, in a predictable category and alphabetical order.
  $: paletteKeyOptions = [
    ...new Map(basicKeyOptions.map((key) => [key.source_key, key])).values(),
  ].sort(comparePaletteKeys);
  $: activeRows = activeGeometry
    ? [...new Set(activeGeometry.keys.map((key) => key.row))].sort(
        (left, right) => left - right,
      )
    : [];
  $: activeLayer = activeProfile?.layers.find(
    (layer) => layer.id === selectedLayerID,
  );
  $: editorOpen = view === "editor" && Boolean(activeProfile);
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
  function isConfigurable(device: Device) {
    return device.role === undefined || device.role === "input";
  }
  function paletteKeyGroup(key: KeyOption) {
    if (/^[0-9]$/.test(key.source_key)) return 0;
    if (/^[a-z]$/.test(key.source_key)) return 1;
    if (modifierSourceKeys.has(key.source_key)) return 2;
    return 3;
  }
  function comparePaletteKeys(left: KeyOption, right: KeyOption) {
    const groupDifference = paletteKeyGroup(left) - paletteKeyGroup(right);
    if (groupDifference) return groupDifference;
    if (paletteKeyGroup(left) === 0) {
      return Number(left.source_key) - Number(right.source_key);
    }
    return (
      left.label.localeCompare(right.label, undefined, {
        sensitivity: "base",
      }) || left.source_key.localeCompare(right.source_key)
    );
  }
  function paletteLabel(key: KeyOption) {
    const compactLabels: Record<string, string> = {
      bspc: "Bksp",
      fwd: "Fwd",
    };
    return compactLabels[key.source_key] ?? key.label;
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
  function configurationsForDevice(device: Device): Configuration[] {
    return configurations.filter(
      (configuration) => configuration.device_id === device.id,
    );
  }
  async function setLifecycleEnabled(
    configuration: Configuration,
    enabled: boolean,
  ) {
    if (configuration.ownership !== "managed" || lifecycleBusyID) return;
    lifecycleBusyID = configuration.id;
    feedback = "";
    try {
      const result = await SetConfigurationEnabled(configuration.id, enabled);
      await refresh();
      feedback = `Manager ${enabled ? "enabled" : "disabled"} bindings: ${result.reason}`;
    } catch (error) {
      feedback = explain(error);
    } finally {
      lifecycleBusyID = "";
    }
  }
  function profileForDevice(device: Device): Profile | undefined {
    return profiles.find((profile) => profile.device_id === device.id);
  }
  function behaviorFor(sourceKey: string): ProfileBehavior | undefined {
    return activeProfile?.assignments?.find(
      (assignment) =>
        assignment.layer_id === selectedLayerID &&
        assignment.source_key === sourceKey,
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
    if (behavior.kind === "tap_hold") {
      return `Tap ${behavior.tap?.key ?? "…"} / hold ${
        behavior.hold?.kind === "hold_layer"
          ? layerName(behavior.hold.target)
          : (behavior.hold?.key ?? "…")
      }`;
    }
    if (behavior.kind === "hold_layer")
      return `Hold ${layerName(behavior.target)}`;
    if (behavior.kind === "switch_layer")
      return `Switch ${layerName(behavior.target)}`;
    if (behavior.kind === "alias") return `@${behavior.target}`;
    if (behavior.kind === "macro") return `Macro ${behavior.target}`;
    return humanize(behavior.kind);
  }
  function layerName(id: string | undefined) {
    return activeProfile?.layers.find((layer) => layer.id === id)?.name ?? id;
  }
  function clearPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = undefined;
  }
  function clearManagerCheckTimer() {
    if (managerCheckTimer) clearInterval(managerCheckTimer);
    managerCheckTimer = undefined;
  }
  function startManagerCheckTimer() {
    clearManagerCheckTimer();
    managerCheckTimer = setInterval(() => {
      if (!loading) void refresh();
    }, managerCheckIntervalMS);
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
    if (!canIdentify || !isConfigurable(device) || !isConnected(device)) return;
    selectedDevice = device;
    operation = null;
    feedback = "";
    identifyOpen = true;
  }
  function closeIdentify() {
    if (operation && !terminal(operation.state)) void cancelIdentify();
    identifyOpen = false;
  }
  function handleIdentifyKeydown(event: KeyboardEvent) {
    if (event.key === "Escape" && identifyOpen) closeIdentify();
  }
  function handleEditorKeydown(event: KeyboardEvent) {
    if (
      !editorOpen ||
      selectedSourceKey ||
      event.repeat ||
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLSelectElement ||
      event.target instanceof HTMLTextAreaElement
    )
      return;
    const sourceKey = browserCodeToSourceKey[event.code];
    if (
      !sourceKey ||
      !activeGeometry?.keys.some((key) => key.source_key === sourceKey)
    )
      return;
    flashingSourceKey = sourceKey;
    if (keyFlashTimer) clearTimeout(keyFlashTimer);
    keyFlashTimer = setTimeout(() => {
      flashingSourceKey = "";
      keyFlashTimer = undefined;
    }, 240);
  }
  function handleGlobalKeydown(event: KeyboardEvent) {
    handleIdentifyKeydown(event);
    handleEditorKeydown(event);
  }
  function openDraft(device: Device) {
    if (!canShowDevices || !isConfigurable(device)) return;
    selectedDevice = device;
    feedback = "";
    profilePreview = null;
    const draft = profileForDevice(device);
    if (draft) {
      activeProfile = draft;
      selectedSourceKey = "";
      selectedLayerID = "base";
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
      selectedSourceKey = "";
      selectedLayerID = "base";
      view = "editor";
      schedulePreview(activeProfile);
    } catch (error) {
      feedback = explain(error);
    } finally {
      profileBusy = false;
    }
  }
  function withSelectedBehavior(
    draft: Profile,
    behavior: ProfileBehavior,
  ): Profile {
    const assignments = (draft.assignments ?? []).filter(
      (assignment) =>
        assignment.layer_id !== selectedLayerID ||
        assignment.source_key !== selectedSourceKey,
    );
    assignments.push({
      layer_id: selectedLayerID,
      source_key: selectedSourceKey,
      behavior,
    });
    return { ...draft, assignments };
  }
  async function saveDraft(draft: Profile): Promise<Profile | undefined> {
    if (profileBusy) return undefined;
    profileBusy = true;
    feedback = "";
    profilePreview = null;
    try {
      const saved = await SaveProfile(draft);
      activeProfile = saved;
      profiles = profiles.map((profile) =>
        profile.id === saved.id ? saved : profile,
      );
      schedulePreview(saved);
      return saved;
    } catch (error) {
      feedback = explain(error);
      return undefined;
    } finally {
      profileBusy = false;
    }
  }
  async function assignBehavior(behavior: ProfileBehavior) {
    if (!activeProfile || !selectedSourceKey || profileBusy) return false;
    return Boolean(
      await saveDraft(withSelectedBehavior(activeProfile, behavior)),
    );
  }
  async function restoreSelectedKey() {
    if (!activeProfile || !selectedSourceKey || profileBusy) return;
    const assignments = (activeProfile.assignments ?? []).filter(
      (assignment) =>
        assignment.layer_id !== selectedLayerID ||
        assignment.source_key !== selectedSourceKey,
    );
    await saveDraft({ ...activeProfile, assignments });
  }
  function openBehaviorDialog(kind: ComplexAction) {
    if (!activeProfile || !selectedSourceKey) {
      feedback = "Select a physical key before choosing a complex action.";
      return;
    }
    const fallback = paletteKeyOptions[0]?.source_key ?? "";
    tapKey ||= fallback;
    holdKey ||= fallback;
    aliasKey ||= fallback;
    macroNextKey ||= fallback;
    tapHoldLayerID = selectedLayerID;
    layerTargetID = selectedLayerID;
    behaviorDialog = kind;
  }
  function closeBehaviorDialog() {
    behaviorDialog = null;
  }
  async function assignTapHold() {
    if (!tapKey || !holdKey || tapHoldTimeoutMS <= 0) return;
    const hold: ProfileBehavior =
      tapHoldMode === "layer"
        ? { kind: "hold_layer", target: tapHoldLayerID }
        : { kind: "key", key: holdKey };
    if (
      await assignBehavior({
        kind: "tap_hold",
        tap: { kind: "key", key: tapKey },
        hold,
        timeout_ms: tapHoldTimeoutMS,
      })
    ) {
      closeBehaviorDialog();
    }
  }
  async function assignLayerAction() {
    if (!layerTargetID) return;
    if (await assignBehavior({ kind: layerAction, target: layerTargetID })) {
      closeBehaviorDialog();
    }
  }
  function declarationNameIsValid(name: string) {
    return /^[A-Za-z][A-Za-z0-9-]*$/.test(name);
  }
  async function createAlias() {
    if (!activeProfile || !aliasKey || !declarationNameIsValid(aliasName)) {
      feedback =
        "Alias names must start with a letter and contain only letters, numbers, or hyphens.";
      return;
    }
    if (
      activeProfile.aliases?.[aliasName] ||
      activeProfile.macros?.[aliasName]
    ) {
      feedback = "That alias or macro name is already in use.";
      return;
    }
    const draft = withSelectedBehavior(
      {
        ...activeProfile,
        aliases: {
          ...(activeProfile.aliases ?? {}),
          [aliasName]: { kind: "key", key: aliasKey },
        },
      },
      { kind: "alias", target: aliasName },
    );
    if (await saveDraft(draft)) {
      aliasName = "";
      closeBehaviorDialog();
    }
  }
  function addMacroStep() {
    if (macroNextKey) macroSteps = [...macroSteps, macroNextKey];
  }
  async function createMacro() {
    if (
      !activeProfile ||
      !declarationNameIsValid(macroName) ||
      !macroSteps.length
    ) {
      feedback = "A macro needs a valid name and at least one key press.";
      return;
    }
    if (
      activeProfile.aliases?.[macroName] ||
      activeProfile.macros?.[macroName]
    ) {
      feedback = "That alias or macro name is already in use.";
      return;
    }
    const draft = withSelectedBehavior(
      {
        ...activeProfile,
        macros: {
          ...(activeProfile.macros ?? {}),
          [macroName]: macroSteps.map((key) => ({ kind: "key", key })),
        },
      },
      { kind: "macro", target: macroName },
    );
    if (await saveDraft(draft)) {
      macroName = "";
      macroSteps = [];
      closeBehaviorDialog();
    }
  }
  async function createLayer() {
    if (!activeProfile || !newLayerName.trim()) return;
    const name = newLayerName.trim();
    if (activeProfile.layers.some((layer) => layer.name === name)) {
      feedback = "A layer with that name already exists.";
      return;
    }
    const stem =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "layer";
    let id = `layer-${stem}`;
    let suffix = 2;
    while (activeProfile.layers.some((layer) => layer.id === id)) {
      id = `layer-${stem}-${suffix++}`;
    }
    if (
      await saveDraft({
        ...activeProfile,
        layers: [...activeProfile.layers, { id, name }],
      })
    ) {
      selectedLayerID = id;
      layerTargetID = id;
      tapHoldLayerID = id;
      newLayerName = "";
    }
  }
  function schedulePreview(draft: Profile) {
    if (previewTimer) clearTimeout(previewTimer);
    if (keyFlashTimer) clearTimeout(keyFlashTimer);
    const generation = ++previewGeneration;
    previewBusy = true;
    previewTimer = setTimeout(() => {
      previewTimer = undefined;
      void previewDraft(draft, generation);
    }, 250);
  }
  async function applyDraft() {
    if (!activeProfile || !canApply || applyBusy) return;
    applyBusy = true;
    feedback = "";
    try {
      const result: ProfileApplyResult = await ApplyProfile(activeProfile.id);
      activeProfile = result.profile;
      profiles = profiles.map((profile) =>
        profile.id === result.profile.id ? result.profile : profile,
      );
      applyOperation = result.operation;
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
    startManagerCheckTimer();
  });
  onDestroy(() => {
    clearPolling();
    clearManagerCheckTimer();
    if (previewTimer) clearTimeout(previewTimer);
    stopWorkspaceEvents?.();
  });
</script>

<svelte:head><title>{info.name}</title></svelte:head>
<svelte:window on:keydown={handleGlobalKeydown} />

<div class:editor-mode={editorOpen} class="app-shell">
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
    </div>
  </header>

  <main class:editor-main={editorOpen}>
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
              ? `${visibleBoards.length} known`
              : "Waiting for manager capability"}</span
          >
        </div>
        {#if canShowDevices && visibleBoards.length === 0}
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
            {#each sortedBoards as device, index (device.id)}
              {#if index === setUpBoards.length && unconfiguredBoards.length}
                <div class="device-list-section">Not set up yet</div>
              {/if}
              {@const deviceConfigurations = configurationsForDevice(device)}
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
                  {#each deviceConfigurations as configuration (configuration.id)}
                    <small
                      >{configuration.ownership} configuration · bindings
                      {configuration.enabled ? "enabled" : "disabled"} ·
                      {humanize(configuration.runtime.phase)} · desired
                      {configuration.desired_revision} / active
                      {configuration.active_revision}</small
                    >
                  {/each}
                </div>
                <div class="device-actions">
                  <button
                    class="button text identify-trigger"
                    on:click={() => openIdentify(device)}
                    disabled={!canIdentify ||
                      !isConfigurable(device) ||
                      !isConnected(device)}
                    aria-label="Identify"
                    title={!canIdentify
                      ? deviceIdentification.reason
                      : !isConnected(device)
                        ? "Identification needs a connected keyboard."
                        : "Identify this keyboard"}
                    ><svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M12 4a8 8 0 1 1-8 8" />
                      <path d="M12 8a4 4 0 1 1-4 4" />
                      <path d="M4 4l8 8" />
                      <circle cx="12" cy="12" r="1.5" />
                    </svg></button
                  >
                  <button
                    class="button primary"
                    on:click={() => openDraft(device)}
                    disabled={!canShowDevices ||
                      !isConfigurable(device) ||
                      geometries.length === 0}
                    title={geometries.length === 0
                      ? "Loading verified keyboard geometries."
                      : profileForDevice(device)
                        ? "Open this local keyboard draft"
                        : "Create a local keyboard draft"}
                    >{profileForDevice(device)
                      ? "Edit draft"
                      : "Set up"}</button
                  >
                  {#each deviceConfigurations.filter((item) => item.ownership === "managed") as configuration (configuration.id)}
                    <label
                      class:disabled={!configuration.enabled ||
                        lifecycleBusyID === configuration.id}
                      class="binding-toggle"
                      title={!managedConfigurations.available
                        ? managedConfigurations.reason
                        : configuration.enabled
                          ? "Uncheck to disable this keyboard’s managed bindings"
                          : "Check to enable this keyboard’s managed bindings"}
                    >
                      <input
                        type="checkbox"
                        checked={configuration.enabled}
                        disabled={!!lifecycleBusyID ||
                          !managedConfigurations.available ||
                          !isConfigurable(device)}
                        on:change={(event) =>
                          setLifecycleEnabled(
                            configuration,
                            event.currentTarget.checked,
                          )}
                        aria-label={`Enable bindings for ${configuration.name}`}
                      />
                      <span
                        >{lifecycleBusyID === configuration.id
                          ? "Changing bindings…"
                          : configuration.enabled
                            ? "Bindings enabled"
                            : "Bindings disabled"}</span
                      >
                    </label>
                  {/each}
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
                <button
                  class="button text identify-trigger"
                  aria-label="Identify"
                  title="Device discovery is unavailable"
                  disabled
                  ><svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 4a8 8 0 1 1-8 8" />
                    <path d="M12 8a4 4 0 1 1-4 4" />
                    <path d="M4 4l8 8" />
                    <circle cx="12" cy="12" r="1.5" />
                  </svg></button
                ><button class="button primary" disabled>Set up</button>
              </div>
            </article>
          </section>
        {/if}
        <p class="boundary-note">
          KeyboarDeer does not inspect input devices or supervise mappings. The
          manager owns those responsibilities.
        </p>
        {#if feedback}<p class="inline-feedback" role="status">
            {feedback}
          </p>{/if}
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
        <div class="editor-heading">
          <nav aria-label="Editor breadcrumb">
            <button class="back-link" on:click={backToDevices}
              >← All keyboards</button
            >
          </nav>
          <div class="editor-title">
            <h1 id="editor-title">{activeProfile.name}</h1>
            <span>{selectedDevice?.display_name ?? "Keyboard"}</span>
          </div>
          <span class="build-label"
            >{activeProfile.manager_configuration_id
              ? "MANAGED PROFILE"
              : "DRAFT ONLY"}</span
          >
          {#if previewBusy}
            <span
              class="configuration-indicator checking"
              aria-label="Checking draft preview"
            ></span>
          {:else if currentPreview?.validation.outcome === "valid"}
            <span
              class="configuration-indicator valid"
              aria-label="Valid configuration"><i></i>Valid configuration</span
            >
          {/if}
          <button
            class="button primary editor-apply"
            type="button"
            on:click={applyDraft}
            disabled={!canApply || applyBusy}
            title={canApply
              ? "Apply this validated draft to the keyboard"
              : "Apply requires a current valid manager preview, a connected keyboard, and the managed-configurations capability."}
            >{applyBusy ? "Applying…" : "Apply to keyboard"}</button
          >
        </div>
        {#if activeGeometry}
          <div class="editor-scroll-region">
            <div class="keyboard-editor" aria-label={activeGeometry.name}>
              {#if currentPreview && currentPreview.validation.outcome !== "valid"}
                <aside class="preview-message" aria-live="polite">
                  <strong
                    >Preview {humanize(
                      currentPreview.validation.outcome,
                    )}</strong
                  >
                  <p>{currentPreview.validation.reason}</p>
                  {#if currentPreview.validation.outcome === "rejected"}
                    <p>
                      No keyboard mapping has been applied. The manager did not
                      provide a reliable key location for this result.
                    </p>
                  {/if}
                </aside>
              {/if}
              {#each activeRows as row}
                <div class="keyboard-row">
                  {#each activeGeometry.keys.filter((key) => key.row === row) as key (key.id)}
                    <button
                      class:selected-key={selectedSourceKey === key.source_key}
                      class:flashing-key={flashingSourceKey === key.source_key}
                      class="editor-key"
                      style={`width: ${key.width * 42}px; margin-left: ${(key.gap_before ?? 0) * 42}px`}
                      on:click={() =>
                        (selectedSourceKey =
                          selectedSourceKey === key.source_key
                            ? ""
                            : key.source_key)}
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
            {#if activeProfile.apply_pending}
              <p class="apply-status">
                An Apply sent at {new Date(
                  activeProfile.apply_pending.started_at,
                ).toLocaleString()} has an unknown outcome. To prevent a duplicate
                configuration, KeyboarDeer will not retry it automatically.
              </p>
            {:else if applyOperation}
              <p class="apply-status">
                Manager Apply: {humanize(applyOperation.state)} —
                {applyOperation.reason}
              </p>
            {/if}
            {#if feedback}<p class="inline-feedback" role="status">
                {feedback}
              </p>{/if}
          </div>
          <section class="key-palette" aria-label="Basic key assignments">
            <div class="palette-toolbar">
              <div class="selected-key-context">
                <strong>{selectedSourceKey || "Select a key"}</strong>
                <span
                  >{activeLayer ? `${activeLayer.name} layer` : "No active layer"}</span
                >
              </div>
              <div class="layer-tabs" role="tablist" aria-label="Keymap layers">
                {#each activeProfile.layers as layer (layer.id)}
                  <button
                    class:active={selectedLayerID === layer.id}
                    class="button secondary layer-tab"
                    role="tab"
                    aria-selected={selectedLayerID === layer.id}
                    on:click={() => (selectedLayerID = layer.id)}
                    >{layer.name}</button
                  >
                {/each}
              </div>
              <div class="complex-actions">
                <button
                  class="button secondary"
                  on:click={() => openBehaviorDialog("tap_hold")}
                  disabled={!selectedSourceKey || profileBusy}>Tap &amp; hold</button
                >
                <button
                  class="button secondary"
                  on:click={() => openBehaviorDialog("layer")}
                  disabled={!selectedSourceKey || profileBusy}>Layer action</button
                >
                <button
                  class="button secondary"
                  on:click={() => openBehaviorDialog("alias")}
                  disabled={!selectedSourceKey || profileBusy}>Alias</button
                >
                <button
                  class="button secondary"
                  on:click={() => openBehaviorDialog("macro")}
                  disabled={!selectedSourceKey || profileBusy}>Macro</button
                >
                {#each Object.keys(activeProfile.aliases ?? {}).sort() as name}
                  <button
                    class="button secondary declaration-action"
                    on:click={() => assignBehavior({ kind: "alias", target: name })}
                    disabled={!selectedSourceKey || profileBusy}
                    title={`Assign alias ${name}`}>@{name}</button
                  >
                {/each}
                {#each Object.keys(activeProfile.macros ?? {}).sort() as name}
                  <button
                    class="button secondary declaration-action"
                    on:click={() => assignBehavior({ kind: "macro", target: name })}
                    disabled={!selectedSourceKey || profileBusy}
                    title={`Assign macro ${name}`}>#{name}</button
                  >
                {/each}
              </div>
            </div>
            <div class="palette-buttons">
              {#each paletteKeyOptions as key (key.source_key)}
                <button
                  class="button secondary palette-key"
                  on:click={() =>
                    assignBehavior({
                      kind: "key",
                      key: key.source_key,
                    })}
                  disabled={profileBusy || !selectedSourceKey}
                  title={`Assign ${key.label} (${key.source_key})`}
                  ><span>{paletteLabel(key)}</span><small
                    >{key.source_key}</small
                  ></button
                >
              {/each}
              <div class="palette-utility">
                <button
                  class="button secondary palette-disable"
                  on:click={() => assignBehavior({ kind: "disabled" })}
                  disabled={profileBusy || !selectedSourceKey}
                  >Disable selected key</button
                >
                <button
                  class="button secondary palette-restore"
                  on:click={restoreSelectedKey}
                  disabled={profileBusy || !selectedSourceKey}
                  >Restore original</button
                >
              </div>
            </div>
          </section>
        {:else}
          <div class="editor-scroll-region">
            <section class="manager-notice" data-state="incomplete">
              <span class="notice-symbol" aria-hidden="true">!</span>
              <div>
                <h2>Geometry unavailable</h2>
                <p>
                  This draft refers to a geometry this version cannot render.
                </p>
              </div>
            </section>
            {#if feedback}<p class="inline-feedback" role="status">
                {feedback}
              </p>{/if}
          </div>
        {/if}
      </section>
    {/if}
  </main>
  {#if behaviorDialog && activeProfile}
    <div class="behavior-dialog-backdrop">
      <dialog
        class="behavior-dialog"
        open
        aria-labelledby="behavior-dialog-title"
      >
        <button
          class="behavior-dialog-close"
          on:click={closeBehaviorDialog}
          aria-label="Close complex action dialog"
          title="Close">×</button
        >
        <p class="eyebrow">COMPLEX ACTION · {selectedSourceKey}</p>
        {#if behaviorDialog === "tap_hold"}
          <h2 id="behavior-dialog-title">Tap &amp; hold</h2>
          <p class="dialog-intro">
            Choose what happens for a quick tap and what happens while the key
            is held. The manager validates the complete draft before it can be
            applied.
          </p>
          <form class="behavior-form" on:submit|preventDefault={assignTapHold}>
            <label for="tap-key">Tap</label>
            <select id="tap-key" bind:value={tapKey}>
              {#each paletteKeyOptions as key (key.source_key)}
                <option value={key.source_key}>{key.label}</option>
              {/each}
            </select>
            <label for="hold-type">Hold</label>
            <select id="hold-type" bind:value={tapHoldMode}>
              <option value="key">Send a key</option>
              <option value="layer">Hold a layer</option>
            </select>
            {#if tapHoldMode === "key"}
              <label for="hold-key">Held key</label>
              <select id="hold-key" bind:value={holdKey}>
                {#each paletteKeyOptions as key (key.source_key)}
                  <option value={key.source_key}>{key.label}</option>
                {/each}
              </select>
            {:else}
              <label for="tap-hold-layer">Layer while held</label>
              <select id="tap-hold-layer" bind:value={tapHoldLayerID}>
                {#each activeProfile.layers as layer (layer.id)}
                  <option value={layer.id}>{layer.name}</option>
                {/each}
              </select>
            {/if}
            <label for="tap-hold-timeout">Tap timeout (milliseconds)</label>
            <input
              id="tap-hold-timeout"
              type="number"
              bind:value={tapHoldTimeoutMS}
              min="1"
              max="1000"
              required
            />
            <div class="behavior-form-actions">
              <button
                class="button secondary"
                type="button"
                on:click={closeBehaviorDialog}>Cancel</button
              >
              <button class="button primary" disabled={profileBusy} type="submit"
                >Assign tap &amp; hold</button
              >
            </div>
          </form>
        {:else if behaviorDialog === "layer"}
          <h2 id="behavior-dialog-title">Layer action</h2>
          <p class="dialog-intro">
            Hold a layer temporarily, or switch to it until another layer action
            changes the active layer.
          </p>
          <form
            class="behavior-form"
            on:submit|preventDefault={assignLayerAction}
          >
            <label for="layer-action">When this key is pressed</label>
            <select id="layer-action" bind:value={layerAction}>
              <option value="hold_layer">Hold this layer</option>
              <option value="switch_layer">Switch to this layer</option>
            </select>
            <label for="layer-target">Target layer</label>
            <select id="layer-target" bind:value={layerTargetID}>
              {#each activeProfile.layers as layer (layer.id)}
                <option value={layer.id}>{layer.name}</option>
              {/each}
            </select>
            <div class="new-layer-control">
              <label for="new-layer-name">Or add a layer</label>
              <div>
                <input
                  id="new-layer-name"
                  bind:value={newLayerName}
                  maxlength="40"
                  placeholder="Navigation"
                />
                <button
                  class="button secondary"
                  type="button"
                  disabled={profileBusy || !newLayerName.trim()}
                  on:click={createLayer}>Add layer</button
                >
              </div>
            </div>
            <div class="behavior-form-actions">
              <button
                class="button secondary"
                type="button"
                on:click={closeBehaviorDialog}>Cancel</button
              >
              <button class="button primary" disabled={profileBusy} type="submit"
                >Assign layer action</button
              >
            </div>
          </form>
        {:else if behaviorDialog === "alias"}
          <h2 id="behavior-dialog-title">Named alias</h2>
          <p class="dialog-intro">
            Save a reusable name for a key action, then assign that alias to the
            selected key.
          </p>
          <form class="behavior-form" on:submit|preventDefault={createAlias}>
            <label for="alias-name">Alias name</label>
            <input
              id="alias-name"
              bind:value={aliasName}
              maxlength="40"
              pattern="[A-Za-z][A-Za-z0-9-]*"
              placeholder="escape-key"
              required
            />
            <label for="alias-key">Action</label>
            <select id="alias-key" bind:value={aliasKey}>
              {#each paletteKeyOptions as key (key.source_key)}
                <option value={key.source_key}>{key.label}</option>
              {/each}
            </select>
            <div class="behavior-form-actions">
              <button
                class="button secondary"
                type="button"
                on:click={closeBehaviorDialog}>Cancel</button
              >
              <button class="button primary" disabled={profileBusy} type="submit"
                >Create and assign alias</button
              >
            </div>
          </form>
        {:else}
          <h2 id="behavior-dialog-title">Macro sequence</h2>
          <p class="dialog-intro">
            Build an ordered sequence of key presses. It will be saved as a named
            macro and assigned to the selected key.
          </p>
          <form class="behavior-form" on:submit|preventDefault={createMacro}>
            <label for="macro-name">Macro name</label>
            <input
              id="macro-name"
              bind:value={macroName}
              maxlength="40"
              pattern="[A-Za-z][A-Za-z0-9-]*"
              placeholder="paste-line"
              required
            />
            <label for="macro-next-key">Add a key press</label>
            <div class="macro-step-control">
              <select id="macro-next-key" bind:value={macroNextKey}>
                {#each paletteKeyOptions as key (key.source_key)}
                  <option value={key.source_key}>{key.label}</option>
                {/each}
              </select>
              <button class="button secondary" type="button" on:click={addMacroStep}
                >Add</button
              >
            </div>
            <ol class="macro-steps" aria-label="Macro key sequence">
              {#each macroSteps as step, index (`${step}-${index}`)}
                <li>
                  <span>{step}</span>
                  <button
                    type="button"
                    on:click={() =>
                      (macroSteps = macroSteps.filter(
                        (_, stepIndex) => stepIndex !== index,
                      ))}>Remove</button
                  >
                </li>
              {/each}
            </ol>
            <div class="behavior-form-actions">
              <button
                class="button secondary"
                type="button"
                on:click={closeBehaviorDialog}>Cancel</button
              >
              <button
                class="button primary"
                disabled={profileBusy || !macroSteps.length}
                type="submit">Create and assign macro</button
              >
            </div>
          </form>
        {/if}
      </dialog>
    </div>
  {/if}
  {#if identifyOpen && selectedDevice}
    <div class="identify-dialog-backdrop">
      <dialog class="identify-dialog" open aria-labelledby="identify-title">
        <button
          class="identify-close"
          on:click={closeIdentify}
          aria-label="Close keyboard identification"
          title="Close identification">×</button
        >
        <div class="identify-dialog-heading">
          <p class="eyebrow">LET’S FIND YOUR KEYBOARD</p>
          <h2 id="identify-title">Is this the one?</h2>
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
      </dialog>
    </div>
  {/if}
  <footer>
    Drafts remain your source of truth; the manager owns generated runtime
    configurations.
  </footer>
</div>
