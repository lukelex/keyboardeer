<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import Button from "./components/Button.svelte";
  import {
    applyAssignmentRecovery,
    assignmentMatchesIssue,
    assignmentRecovery,
    mapDiagnosticToAssignment,
    withPreEditFallback,
    type MappedAssignmentIssue,
  } from "./validationRecovery";
  import {
    ApplyProfile,
    DiscardPendingApply,
    ResumeApply,
    CreateProfile,
    DeleteConfiguration,
    DeleteProfile,
    DuplicateProfile,
    ExportConfiguration,
    ExportProfile,
    Geometries,
    IdentifyCancel,
    IdentifyOperation,
    IdentifyStart,
    ImportProfile,
    Info,
    PreviewProfile,
    Profiles,
    ProfileStoreStatus,
    RecoverCorruptProfileStore,
    SaveProfile,
    SelectedProfiles,
    SelectProfile,
    SetConfigurationEnabled,
    Workspace,
    type AppInfo,
    type Capability,
    type Configuration,
    type ConfigurationExport,
    type Device,
    type GeometryTemplate,
    type ManagerStatus,
    type ManagerWorkspace,
    type Operation,
    type Profile,
    type ProfileApplyResult,
    type ProfileBehavior,
    type ProfilePreview,
    type ProfileStoreStatus as ProfileStoreState,
  } from "./desktop";

  type View = "devices" | "setup" | "editor";
  type KeyOption = GeometryTemplate["keys"][number];
  type PaletteKey = Pick<KeyOption, "label" | "source_key">;
  type PaletteCategory = "all" | "0" | "1" | "2" | "3" | "4" | "5" | "6";
  type ComplexAction = "tap_hold" | "layer" | "alias" | "macro" | "layers";
  type EditableState = Pick<
    Profile,
    "layers" | "assignments" | "aliases" | "macros"
  >;
  type DraftHistory = { past: EditableState[]; future: EditableState[] };
  type DraftSaveState = "saved" | "saving" | "failed";
  const draftHistoryLimit = 100;
  const defaultTapHoldTimeoutMS = 200;
  const compactPaletteHeight = 720;
  const paletteCategories: { id: PaletteCategory; label: string }[] = [
    { id: "all", label: "All" },
    { id: "0", label: "Numbers" },
    { id: "1", label: "Letters" },
    { id: "2", label: "Modifiers" },
    { id: "3", label: "Function" },
    { id: "4", label: "Navigation" },
    { id: "5", label: "Media" },
    { id: "6", label: "Other" },
  ];
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
  const navigationSystemKeys = [
    { label: "Num Lock", source_key: "nlck" },
    { label: "Scroll Lock", source_key: "scrlck" },
    { label: "System Request", source_key: "ssrq" },
    { label: "Break", source_key: "break" },
  ];
  const navigationSystemSourceKeys = new Set([
    "ins",
    "home",
    "pgup",
    "del",
    "end",
    "pgdn",
    "up",
    "down",
    "left",
    "rght",
    "prnt",
    "pause",
    ...navigationSystemKeys.map((key) => key.source_key),
  ]);
  const mediaSystemKeys = [
    { label: "Mute", source_key: "mute" },
    { label: "Volume up", source_key: "volu" },
    { label: "Volume down", source_key: "voldwn" },
    { label: "Play / pause", source_key: "pp" },
    { label: "Next track", source_key: "next" },
    { label: "Previous track", source_key: "prev" },
    { label: "Stop playback", source_key: "stopcd" },
    { label: "Brightness up", source_key: "brup" },
    { label: "Brightness down", source_key: "brdown" },
    { label: "Keyboard backlight toggle", source_key: "kbdillumtoggle" },
    { label: "Keyboard backlight up", source_key: "blup" },
    { label: "Keyboard backlight down", source_key: "bldn" },
    { label: "Eject media", source_key: "eject" },
  ];
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
  for (let functionKey = 1; functionKey <= 24; functionKey += 1) {
    browserCodeToSourceKey[`F${functionKey}`] = `f${functionKey}`;
  }
  const initialStatus: ManagerStatus = {
    state: "checking",
    message: "Checking the local manager connection…",
    endpoint: "",
  };

  let info: AppInfo = { name: "KeyboarDeer", version: "starting…" };
  let workspace: ManagerWorkspace = { status: initialStatus, stale: false };
  const uiStateStorageKey = "keyboardeer-ui-state";
  type PersistedUIState = {
    view?: View;
    deviceID?: string;
    profileID?: string;
    geometryID?: string;
    layerID?: string;
    sourceKey?: string;
  };
  function readPersistedUIState(): PersistedUIState {
    try {
      const value: unknown = JSON.parse(
        localStorage.getItem(uiStateStorageKey) ?? "{}",
      );
      return typeof value === "object" && value !== null
        ? (value as PersistedUIState)
        : {};
    } catch {
      return {};
    }
  }
  const persistedUIState = readPersistedUIState();
  let uiStateRestored = false;
  let view: View = "devices";
  let selectedDevice: Device | null = null;
  let profiles: Profile[] = [];
  let geometries: GeometryTemplate[] = [];
  let selectedGeometryID = "";
  let profileName = "";
  let activeProfile: Profile | null = null;
  let selectedSourceKey = "";
  let selectedLayerID = "base";
  let selectedLayerBehaviors: Record<string, ProfileBehavior> = {};
  let activePaletteCategory: PaletteCategory = "all";
  let viewportHeight = 0;
  let behaviorDialog: ComplexAction | null = null;
  let tapKey = "";
  let tapHoldMode: "key" | "layer" = "key";
  let holdKey = "";
  let tapHoldLayerID = "base";
  let tapHoldTimeoutMS = defaultTapHoldTimeoutMS;
  let layerAction: "hold_layer" | "switch_layer" = "hold_layer";
  let layerTargetID = "base";
  let newLayerName = "";
  let layerRename = "";
  let aliasName = "";
  let aliasKey = "";
  let macroName = "";
  let macroNextKey = "";
  let macroSteps: string[] = [];
  let flashingSourceKey = "";
  let keyFlashTimer: ReturnType<typeof setTimeout> | undefined;
  let profileBusy = false;
  // Undo/redo is session-local and kept per profile, so switching keyboards
  // never applies one draft's history to another.
  let draftHistory: Record<string, DraftHistory> = {};
  let draftSaveState: DraftSaveState = "saved";
  let keySearch = "";
  let selectedProfiles: Record<string, string> = {};
  let profilesOpen = false;
  let profileRename = "";
  let confirmProfileDelete = false;
  let profileStoreProblem: ProfileStoreState | null = null;
  let confirmStoreReset = false;
  let storeRecoveryMessage = "";
  let previewBusy = false;
  let previewInFlight = false;
  let profilePreview: ProfilePreview | null = null;
  let previewTimer: ReturnType<typeof setTimeout> | undefined;
  let previewGeneration = 0;
  let pendingPreview: { draft: Profile; generation: number } | null = null;
  let applyBusy = false;
  let applyReviewOpen = false;
  let applyReviewNotice = "";
  const resumingApplyIDs = new Set<string>();
  const applyFollowTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let applyOperation: Operation | null = null;
  let applyOperationProfileID = "";
  let lifecycleBusyID = "";
  let confirmConfigurationDeleteID = "";
  let operation: Operation | null = null;
  let loading = false;
  let identifyBusy = false;
  let identifyOpen = false;
  let externalOpen = false;
  let rawConfiguration: ConfigurationExport | null = null;
  let rawConfigurationOpen = false;
  let rawConfigurationBusy = false;
  let identifyTimeoutMS = 15_000;
  let identifyDeadlineMS = 0;
  let identifyRemainingSeconds = 0;
  let feedback = "";
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let identifyCountdownTimer: ReturnType<typeof setInterval> | undefined;
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
  $: workspaceLive = workspace.status.state === "ready" && !workspace.stale;
  $: canShowDevices =
    deviceDiscovery.available &&
    !!workspace.snapshot &&
    (workspaceLive || workspace.stale);
  $: canIdentify = workspaceLive && deviceIdentification.available;
  $: devices = workspace.snapshot?.devices ?? [];
  // Device roles are manager-owned semantics. Keep an absent role visible for
  // compatibility with older managers, but never configure an explicit
  // non-input role.
  $: visibleBoards = devices.filter(
    (device) => device.role === undefined || device.role === "input",
  );
  $: configurations = workspace.snapshot?.configurations ?? [];
  $: operations = workspace.snapshot?.operations ?? [];
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
    (device) =>
      !setUpBoards.some((setUpDevice) => setUpDevice.id === device.id),
  );
  $: sortedBoards = [...setUpBoards, ...unconfiguredBoards];
  $: managedConfigurations =
    capabilities.find((item) => item.name === "managed_configurations") ??
    unavailableCapability("managed_configurations");
  $: configurationExport =
    capabilities.find((item) => item.name === "configuration_export") ??
    unavailableCapability("configuration_export");
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
    ...new Map(
      [
        ...basicKeyOptions,
        ...Array.from({ length: 24 }, (_, index) => {
          const number = index + 1;
          return { label: `F${number}`, source_key: `f${number}` };
        }),
        ...navigationSystemKeys,
        ...mediaSystemKeys,
      ].map((key) => [key.source_key, key]),
    ).values(),
  ].sort(comparePaletteKeys);
  $: normalizedKeySearch = keySearch.trim().toLowerCase();
  $: visiblePaletteKeys = normalizedKeySearch
    ? paletteKeyOptions.filter((key) =>
        [key.label, key.source_key, paletteLabel(key)].some((value) =>
          value.toLowerCase().includes(normalizedKeySearch),
        ),
      )
    : paletteKeyOptions;
  $: compactPaletteKeys = visiblePaletteKeys.filter(
    (key) =>
      activePaletteCategory === "all" ||
      paletteKeyGroup(key) === Number(activePaletteCategory),
  );
  $: renderedPaletteKeys = compactPalette
    ? compactPaletteKeys
    : visiblePaletteKeys;
  $: compactPalette =
    viewportHeight > 0 && viewportHeight <= compactPaletteHeight;
  $: activeHistory = activeProfile ? draftHistory[activeProfile.id] : undefined;
  $: canUndo =
    !!activeHistory?.past.length &&
    !profileBusy &&
    !activeProfile?.apply_pending;
  $: canRedo =
    !!activeHistory?.future.length &&
    !profileBusy &&
    !activeProfile?.apply_pending;
  $: draftStatusText =
    draftSaveState === "saving"
      ? "Saving draft…"
      : draftSaveState === "failed"
        ? "Draft not saved"
        : activeProfile
          ? `Draft saved ${new Date(activeProfile.updated_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
          : "";
  $: activeRows = activeGeometry
    ? [...new Set(activeGeometry.keys.map((key) => key.row))].sort(
        (left, right) => left - right,
      )
    : [];
  $: activeLayer = activeProfile?.layers.find(
    (layer) => layer.id === selectedLayerID,
  );
  $: selectedLayerIndex =
    activeProfile?.layers.findIndex((layer) => layer.id === selectedLayerID) ??
    -1;
  $: selectedLayerAssignments =
    activeProfile?.assignments?.filter(
      (assignment) => assignment.layer_id === selectedLayerID,
    ).length ?? 0;
  $: selectedLayerBehaviors = Object.fromEntries(
    (activeProfile?.assignments ?? [])
      .filter((assignment) => assignment.layer_id === selectedLayerID)
      .map((assignment) => [assignment.source_key, assignment.behavior]),
  );
  $: selectedLayerReferences = activeProfile
    ? layerEntryCount(selectedLayerID)
    : 0;
  $: editorOpen = view === "editor" && Boolean(activeProfile);
  $: if (uiStateRestored) {
    try {
      localStorage.setItem(
        uiStateStorageKey,
        JSON.stringify({
          view,
          deviceID: selectedDevice?.id,
          profileID: activeProfile?.id,
          geometryID: selectedGeometryID,
          layerID: selectedLayerID,
          sourceKey: selectedSourceKey,
        } satisfies PersistedUIState),
      );
    } catch {
      // The application remains usable when browser storage is unavailable.
    }
  }
  $: currentPreview =
    activeProfile &&
    profilePreview?.profile_id === activeProfile.id &&
    profilePreview.draft_revision === activeProfile.draft_revision &&
    profilePreview.manager_server_id === workspace.status.server_id &&
    profilePreview.state_revision === workspace.snapshot?.state_revision &&
    workspaceLive
      ? profilePreview
      : null;
  $: mappedPreviewIssues =
    activeProfile && currentPreview?.validation.outcome === "rejected"
      ? (currentPreview.validation.diagnostics ?? [])
          .map((diagnostic) =>
            mapDiagnosticToAssignment(
              currentPreview!,
              diagnostic,
              activeProfile!,
            ),
          )
          .filter((issue): issue is MappedAssignmentIssue => issue !== null)
      : [];
  $: linkedConfiguration = activeProfile?.manager_configuration_id
    ? configurations.find(
        (configuration) =>
          configuration.id === activeProfile?.manager_configuration_id,
      )
    : undefined;
  $: shownApplyOperation =
    (applyOperationProfileID === activeProfile?.id ? applyOperation : null) ??
    activeProfile?.last_apply_operation ??
    linkedConfiguration?.last_operation ??
    null;
  // The validation dot is always shown; only its color and label change.
  $: validationState =
    currentPreview?.validation.outcome === "valid"
      ? "valid"
      : previewBusy
        ? "checking"
        : (currentPreview?.validation.outcome ?? "unchecked");
  $: validationLabel =
    {
      checking: "Checking draft preview",
      valid: "Valid configuration",
      rejected: "Invalid configuration",
      blocked: "Validation blocked",
      unchecked: "Draft not validated",
    }[validationState] ?? `Validation ${humanize(validationState)}`;
  $: canApply =
    !!activeProfile &&
    workspaceLive &&
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
  function deviceState(device: Device) {
    return device.runtime_conflict
      ? "conflict"
      : device.availability || "unknown";
  }
  function deviceStateSummary(device: Device) {
    switch (deviceState(device)) {
      case "connected":
        return "Ready to configure.";
      case "disconnected":
        return "Reconnect this keyboard to configure or identify it.";
      case "inaccessible":
        return "The manager cannot access this keyboard. Check its input-access permissions.";
      case "unsupported":
        return "The manager does not support this keyboard on the current backend.";
      case "conflict":
        return "Another configuration or mapping conflicts with this keyboard.";
      default:
        return "The manager reported an unfamiliar device state.";
    }
  }
  function isConfigurable(device: Device) {
    return device.role === undefined || device.role === "input";
  }
  function paletteKeyGroup(key: PaletteKey) {
    if (/^[0-9]$/.test(key.source_key)) return 0;
    if (/^[a-z]$/.test(key.source_key)) return 1;
    if (modifierSourceKeys.has(key.source_key)) return 2;
    if (/^f\d+$/.test(key.source_key)) return 3;
    if (navigationSystemSourceKeys.has(key.source_key)) return 4;
    if (mediaSystemKeys.some((item) => item.source_key === key.source_key))
      return 5;
    return 6;
  }
  function paletteGroupLabel(group: number) {
    return {
      3: "Function keys",
      4: "Navigation & system",
      5: "Media & system",
      6: "Other keys",
    }[group];
  }
  function comparePaletteKeys(left: PaletteKey, right: PaletteKey) {
    const groupDifference = paletteKeyGroup(left) - paletteKeyGroup(right);
    if (groupDifference) return groupDifference;
    if (/^f\d+$/.test(left.source_key) && /^f\d+$/.test(right.source_key)) {
      return (
        Number(left.source_key.slice(1)) - Number(right.source_key.slice(1))
      );
    }
    if (paletteKeyGroup(left) === 0) {
      return Number(left.source_key) - Number(right.source_key);
    }
    return (
      left.label.localeCompare(right.label, undefined, {
        sensitivity: "base",
      }) || left.source_key.localeCompare(right.source_key)
    );
  }
  function paletteLabel(key: PaletteKey) {
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
  function operationForConfiguration(configuration: Configuration) {
    return (
      configuration.last_operation ??
      operations.find(
        (operation) =>
          operation.resource?.kind === "configuration" &&
          operation.resource.id === configuration.id,
      )
    );
  }
  function runtimeHealthLabel(configuration: Configuration) {
    if (!configuration.enabled) return "Disabled";
    if (configuration.runtime.healthy) return "Healthy";
    if (!configuration.runtime.connected) return "Waiting for keyboard";
    return "Needs attention";
  }
  function runtimeHealthDetail(configuration: Configuration) {
    return (
      configuration.runtime.reason ||
      "The manager did not provide a runtime explanation for this configuration."
    );
  }
  function diagnosticResourceLabel(
    diagnostic: NonNullable<
      ProfilePreview["validation"]["diagnostics"]
    >[number],
  ) {
    if (!diagnostic.resource) return "Keymap-wide issue";
    if (diagnostic.resource.kind === "device") return "Selected keyboard";
    if (diagnostic.resource.kind === "configuration") return "Configuration";
    // The manager currently does not promise physical-key locations. Preserve
    // opaque, future resource kinds without guessing a key from display text.
    return `${humanize(diagnostic.resource.kind)} issue`;
  }
  function diagnosticIssue(diagnosticID: string) {
    if (!activeProfile || !currentPreview) return null;
    const diagnostic = currentPreview.validation.diagnostics?.find(
      (candidate) => candidate.id === diagnosticID,
    );
    return diagnostic
      ? mapDiagnosticToAssignment(currentPreview, diagnostic, activeProfile)
      : null;
  }
  function recoveryForIssue(issue: MappedAssignmentIssue) {
    if (!activeProfile || !currentPreview) return null;
    return assignmentRecovery(
      activeProfile,
      issue,
      currentPreview.manager_server_id,
    );
  }
  function showMappedIssue(issue: MappedAssignmentIssue) {
    selectedLayerID = issue.layerID;
    selectedSourceKey = issue.sourceKey;
    requestAnimationFrame(() => {
      const key = Array.from(
        document.querySelectorAll<HTMLButtonElement>("[data-issue-key]"),
      ).find(
        (candidate) =>
          candidate.dataset.layerId === issue.layerID &&
          candidate.dataset.sourceKey === issue.sourceKey,
      );
      key?.scrollIntoView({ block: "center", inline: "nearest" });
      key?.focus();
    });
  }
  async function revertMappedIssue(diagnosticID: string) {
    if (!activeProfile || !currentPreview || profileBusy) return;
    const issue = diagnosticIssue(diagnosticID);
    if (!issue || !assignmentMatchesIssue(activeProfile, issue)) {
      feedback =
        "That recovery action is out of date. Check the current preview.";
      return;
    }
    const recovery = recoveryForIssue(issue);
    if (!recovery?.available) {
      feedback =
        recovery?.reason ?? "No safe assignment recovery is available.";
      return;
    }
    const restored = await saveDraft(
      applyAssignmentRecovery(activeProfile, issue, recovery),
    );
    if (restored) {
      selectedLayerID = issue.layerID;
      selectedSourceKey = issue.sourceKey;
      feedback = `Restored ${issue.sourceKey} on ${layerName(issue.layerID)}. Other draft edits were kept; checking the whole draft again.`;
    }
  }
  async function deleteConfiguration(configuration: Configuration) {
    if (configuration.ownership !== "managed" || lifecycleBusyID) return;
    if (confirmConfigurationDeleteID !== configuration.id) {
      confirmConfigurationDeleteID = configuration.id;
      return;
    }
    confirmConfigurationDeleteID = "";
    lifecycleBusyID = configuration.id;
    feedback = "";
    try {
      const result = await DeleteConfiguration(configuration.id);
      await refresh();
      feedback = `Removed “${configuration.name}” from the keyboard: ${result.reason}. Your profiles were kept.`;
    } catch (error) {
      feedback = explain(error);
    } finally {
      lifecycleBusyID = "";
    }
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
  // Reactive function declarations: markup that calls them re-renders when
  // the profile list or the per-keyboard selection changes.
  let profilesForDevice: (deviceID: string) => Profile[];
  $: profilesForDevice = (deviceID: string) =>
    profiles
      .filter((profile) => profile.device_id === deviceID)
      .sort((left, right) => left.created_at.localeCompare(right.created_at));
  let profileForDevice: (device: Device) => Profile | undefined;
  $: profileForDevice = (device: Device) =>
    profiles.find(
      (profile) =>
        profile.id === selectedProfiles[device.id] &&
        profile.device_id === device.id,
    ) ?? profilesForDevice(device.id)[0];
  function openProfiles() {
    if (!activeProfile) return;
    profileRename = activeProfile.name;
    confirmProfileDelete = false;
    profilesOpen = true;
  }
  function closeProfiles() {
    profilesOpen = false;
    confirmProfileDelete = false;
  }
  // Drafts are saved on every edit, so switching never loses pending changes;
  // each profile also keeps its own undo history.
  async function switchProfile(target: Profile) {
    if (!selectedDevice || profileBusy || target.id === activeProfile?.id)
      return;
    try {
      await SelectProfile(selectedDevice.id, target.id);
      selectedProfiles = {
        ...selectedProfiles,
        [selectedDevice.id]: target.id,
      };
      activeProfile =
        profiles.find((profile) => profile.id === target.id) ?? target;
      selectedSourceKey = "";
      selectedLayerID = "base";
      profilePreview = null;
      applyOperation = null;
      draftSaveState = "saved";
      profileRename = activeProfile.name;
      confirmProfileDelete = false;
      schedulePreview(activeProfile);
    } catch (error) {
      feedback = explain(error);
    }
  }
  function uniqueProfileName(base: string) {
    if (!selectedDevice) return base;
    const names = new Set(
      profilesForDevice(selectedDevice.id).map((profile) => profile.name),
    );
    if (!names.has(base)) return base;
    let suffix = 2;
    while (names.has(`${base} ${suffix}`)) suffix += 1;
    return `${base} ${suffix}`;
  }
  async function duplicateActiveProfile() {
    if (!activeProfile || !selectedDevice || profileBusy) return;
    profileBusy = true;
    try {
      const copy = await DuplicateProfile(
        activeProfile.id,
        uniqueProfileName(`${activeProfile.name} copy`.slice(0, 80)),
      );
      profiles = [...profiles, copy];
      profileBusy = false;
      await switchProfile(copy);
    } catch (error) {
      feedback = explain(error);
    } finally {
      profileBusy = false;
    }
  }
  async function exportActiveProfile() {
    if (!activeProfile || profileBusy) return;
    profileBusy = true;
    try {
      await ExportProfile(activeProfile.id);
      feedback =
        "Portable profile exported. It contains behavior and layout data, not a runnable .kbd file.";
    } catch (error) {
      feedback = explain(error);
    } finally {
      profileBusy = false;
    }
  }
  async function viewRawConfiguration() {
    const configurationID = activeProfile?.manager_configuration_id;
    if (!configurationID || rawConfigurationBusy) return;
    rawConfigurationBusy = true;
    feedback = "";
    try {
      rawConfiguration = await ExportConfiguration(configurationID);
      rawConfigurationOpen = true;
    } catch (error) {
      feedback = explain(error);
    } finally {
      rawConfigurationBusy = false;
    }
  }
  async function importProfileForDevice() {
    if (!selectedDevice || profileBusy) return;
    profileBusy = true;
    try {
      const imported = await ImportProfile(selectedDevice.id);
      profiles = [...profiles, imported];
      selectedProfiles = {
        ...selectedProfiles,
        [selectedDevice.id]: imported.id,
      };
      profileBusy = false;
      await switchProfile(imported);
      feedback = `Imported “${imported.name}” as a new draft for this keyboard.`;
    } catch (error) {
      feedback = explain(error);
    } finally {
      profileBusy = false;
    }
  }
  async function renameActiveProfile() {
    if (!activeProfile || !profileRename.trim()) return;
    await saveDraft({ ...activeProfile, name: profileRename.trim() }, false);
  }
  async function deleteActiveProfile() {
    if (!activeProfile || !selectedDevice || profileBusy) return;
    if (!confirmProfileDelete) {
      confirmProfileDelete = true;
      return;
    }
    confirmProfileDelete = false;
    profileBusy = true;
    const deleted = activeProfile;
    try {
      await DeleteProfile(deleted.id, deleted.draft_revision);
      profiles = profiles.filter((profile) => profile.id !== deleted.id);
      draftHistory = Object.fromEntries(
        Object.entries(draftHistory).filter(([id]) => id !== deleted.id),
      );
      selectedProfiles = hasDesktopBinding("SelectedProfiles")
        ? await SelectedProfiles()
        : {};
      profileBusy = false;
      const next = profileForDevice(selectedDevice);
      if (next) {
        activeProfile = null;
        await switchProfile(next);
      } else {
        closeProfiles();
        backToDevices();
      }
    } catch (error) {
      feedback = explain(error);
    } finally {
      profileBusy = false;
    }
  }
  function newProfileForDevice() {
    if (!selectedDevice) return;
    closeProfiles();
    activeProfile = null;
    profilePreview = null;
    profileName = uniqueProfileName(
      selectedDevice.display_name
        ? `${selectedDevice.display_name} profile`
        : "Keyboard profile",
    );
    selectedGeometryID ||= geometries[0]?.id ?? "";
    view = "setup";
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
    if (!behavior)
      return selectedLayerID === "base" ? sourceKey : "Pass through";
    if (behavior.kind === "key") return behavior.key ?? sourceKey;
    if (behavior.kind === "transparent") return "Pass through";
    if (behavior.kind === "disabled") return "No output";
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
  function behaviorSummary(behavior: ProfileBehavior) {
    if (behavior.kind === "key") return `Send ${behavior.key}`;
    if (behavior.kind === "disabled") return "Disable key";
    if (behavior.kind === "transparent") return "Pass through";
    if (behavior.kind === "hold_layer")
      return `Hold ${layerName(behavior.target)}`;
    if (behavior.kind === "switch_layer")
      return `Switch to ${layerName(behavior.target)}`;
    if (behavior.kind === "tap_hold") return "Tap & hold";
    if (behavior.kind === "alias") return `Use alias ${behavior.target}`;
    if (behavior.kind === "macro") return `Run macro ${behavior.target}`;
    return humanize(behavior.kind);
  }
  function layerName(id: string | undefined) {
    return activeProfile?.layers.find((layer) => layer.id === id)?.name ?? id;
  }
  function behaviorTargetsLayer(
    behavior: ProfileBehavior,
    layerID: string,
    seen = new Set<string>(),
  ): boolean {
    if (
      (behavior.kind === "hold_layer" || behavior.kind === "switch_layer") &&
      behavior.target === layerID
    ) {
      return true;
    }
    if (behavior.kind === "tap_hold") {
      return Boolean(
        (behavior.tap && behaviorTargetsLayer(behavior.tap, layerID, seen)) ||
        (behavior.hold && behaviorTargetsLayer(behavior.hold, layerID, seen)),
      );
    }
    if (
      behavior.kind === "alias" &&
      behavior.target &&
      !seen.has(`a:${behavior.target}`)
    ) {
      seen.add(`a:${behavior.target}`);
      const alias = activeProfile?.aliases?.[behavior.target];
      return alias ? behaviorTargetsLayer(alias, layerID, seen) : false;
    }
    if (
      behavior.kind === "macro" &&
      behavior.target &&
      !seen.has(`m:${behavior.target}`)
    ) {
      seen.add(`m:${behavior.target}`);
      return Boolean(
        activeProfile?.macros?.[behavior.target]?.some((step) =>
          behaviorTargetsLayer(step, layerID, seen),
        ),
      );
    }
    return false;
  }
  function layerEntryCount(layerID: string) {
    return (
      activeProfile?.assignments?.filter((assignment) =>
        behaviorTargetsLayer(assignment.behavior, layerID),
      ).length ?? 0
    );
  }
  function layerIsReachable(layerID: string) {
    return layerID === "base" || layerEntryCount(layerID) > 0;
  }
  function clearPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = undefined;
    if (identifyCountdownTimer) clearInterval(identifyCountdownTimer);
    identifyCountdownTimer = undefined;
    identifyDeadlineMS = 0;
    identifyRemainingSeconds = 0;
  }
  function updateIdentifyCountdown() {
    if (!identifyDeadlineMS) return;
    identifyRemainingSeconds = Math.max(
      0,
      Math.ceil((identifyDeadlineMS - Date.now()) / 1000),
    );
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
      acceptWorkspaceUpdate(await Workspace());
      if (workspaceBindingReady) void loadLocalDrafts();
    } catch (error) {
      const desktopUnavailable = !workspaceBindingReady;
      const previous = workspace;
      workspace = {
        status: {
          state: desktopUnavailable ? "browser_preview" : "unavailable",
          message: desktopUnavailable
            ? "This browser preview has no Wails desktop bindings, so it cannot contact the local manager. Use the native KeyboarDeer window launched by scripts/desktop.sh."
            : `The desktop app could not load the manager workspace: ${explain(error)}`,
          endpoint: "",
          capabilities: previous.status.capabilities,
        },
        snapshot: previous.snapshot,
        stale: !!previous.snapshot,
        snapshot_at: previous.snapshot_at,
      };
      invalidatePreview(false);
      feedback = explain(error);
    } finally {
      loading = false;
    }
  }
  async function loadLocalDrafts() {
    try {
      geometries = await Geometries();
      selectedGeometryID ||= geometries[0]?.id ?? "";
    } catch {
      // Browser preview deliberately has no desktop persistence bindings.
    }
    try {
      profiles = await Profiles();
      selectedProfiles = hasDesktopBinding("SelectedProfiles")
        ? await SelectedProfiles()
        : {};
      profileStoreProblem = null;
      restorePersistedUIState();
      resumePendingApplies();
    } catch {
      // Explain a damaged or newer draft file instead of silently showing
      // every keyboard as "not set up".
      if (hasDesktopBinding("ProfileStoreStatus")) {
        const status = await ProfileStoreStatus().catch(() => null);
        profileStoreProblem = status && status.state !== "ok" ? status : null;
      }
    }
  }
  function restorePersistedUIState() {
    if (uiStateRestored) return;
    uiStateRestored = true;
    const saved = persistedUIState;
    const device = workspace.snapshot?.devices?.find(
      (item) => item.id === saved.deviceID && isConfigurable(item),
    );
    if (!device) return;
    selectedDevice = device;
    if (
      saved.geometryID &&
      geometries.some((item) => item.id === saved.geometryID)
    ) {
      selectedGeometryID = saved.geometryID;
    }
    if (saved.view === "setup") {
      profileName = device.display_name
        ? `${device.display_name} draft`
        : "Keyboard draft";
      view = "setup";
      return;
    }
    if (saved.view !== "editor") return;
    const profile =
      profiles.find(
        (item) => item.id === saved.profileID && item.device_id === device.id,
      ) ??
      profiles.find(
        (item) =>
          item.id === selectedProfiles[device.id] &&
          item.device_id === device.id,
      );
    if (!profile) return;
    activeProfile = profile;
    selectedProfiles = { ...selectedProfiles, [device.id]: profile.id };
    selectedLayerID = profile.layers.some((item) => item.id === saved.layerID)
      ? saved.layerID!
      : "base";
    selectedSourceKey = profile.geometry.source_keys.includes(
      saved.sourceKey ?? "",
    )
      ? (saved.sourceKey ?? "")
      : "";
    view = "editor";
    schedulePreview(profile);
  }
  async function recoverProfileStore() {
    if (!confirmStoreReset) {
      confirmStoreReset = true;
      return;
    }
    confirmStoreReset = false;
    try {
      const backup = await RecoverCorruptProfileStore();
      storeRecoveryMessage = `The damaged draft file was kept at ${backup}. KeyboarDeer started a new, empty draft list.`;
      await loadLocalDrafts();
    } catch (error) {
      storeRecoveryMessage = explain(error);
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
    clearPolling();
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
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
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
  function handleHistoryKeydown(event: KeyboardEvent) {
    if (
      !editorOpen ||
      behaviorDialog ||
      profilesOpen ||
      applyReviewOpen ||
      externalOpen ||
      identifyOpen ||
      !(event.ctrlKey || event.metaKey) ||
      event.altKey ||
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLSelectElement ||
      event.target instanceof HTMLTextAreaElement
    )
      return;
    const key = event.key.toLowerCase();
    if (key === "z" && !event.shiftKey) {
      event.preventDefault();
      void undoEdit();
    } else if ((key === "z" && event.shiftKey) || key === "y") {
      event.preventDefault();
      void redoEdit();
    }
  }
  function handleGlobalKeydown(event: KeyboardEvent) {
    handleIdentifyKeydown(event);
    handleHistoryKeydown(event);
    handleEditorKeydown(event);
  }
  function openDraft(device: Device) {
    if (!canShowDevices || !isConfigurable(device)) return;
    selectedDevice = device;
    feedback = "";
    profilePreview = null;
    const draft = profileForDevice(device);
    draftSaveState = "saved";
    keySearch = "";
    if (draft) {
      activeProfile = draft;
      selectedSourceKey = "";
      selectedLayerID = "base";
      view = "editor";
      // A reopened draft is validated right away, not only after an edit.
      schedulePreview(draft);
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
      selectedProfiles = {
        ...selectedProfiles,
        [selectedDevice.id]: activeProfile.id,
      };
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
  function editableState(draft: Profile): EditableState {
    return JSON.parse(
      JSON.stringify({
        layers: draft.layers,
        assignments: draft.assignments,
        aliases: draft.aliases,
        macros: draft.macros,
      }),
    ) as EditableState;
  }
  async function saveDraft(
    draft: Profile,
    recordHistory = true,
  ): Promise<Profile | undefined> {
    if (profileBusy) return undefined;
    const before =
      activeProfile?.id === draft.id ? editableState(activeProfile) : null;
    const saveableDraft =
      activeProfile?.id === draft.id
        ? withPreEditFallback(activeProfile, draft)
        : draft;
    profileBusy = true;
    draftSaveState = "saving";
    feedback = "";
    invalidatePreview(false);
    previewBusy = true;
    try {
      const saved = await SaveProfile(saveableDraft);
      activeProfile = saved;
      profiles = profiles.map((profile) =>
        profile.id === saved.id ? saved : profile,
      );
      if (recordHistory && before) {
        const history = draftHistory[saved.id] ?? { past: [], future: [] };
        draftHistory = {
          ...draftHistory,
          [saved.id]: {
            past: [...history.past, before].slice(-draftHistoryLimit),
            future: [],
          },
        };
      }
      draftSaveState = "saved";
      schedulePreview(saved);
      return saved;
    } catch (error) {
      draftSaveState = "failed";
      previewBusy = false;
      feedback = explain(error);
      return undefined;
    } finally {
      profileBusy = false;
    }
  }
  function reconcileEditorSelection(draft: Profile) {
    if (!draft.layers.some((layer) => layer.id === selectedLayerID)) {
      selectedLayerID = "base";
    }
  }
  // Undo and redo are ordinary revision-guarded draft saves, so they refresh
  // the whole-draft preview exactly like any other semantic edit.
  async function undoEdit() {
    if (!activeProfile || !canUndo) return;
    const history = draftHistory[activeProfile.id];
    const previous = history.past[history.past.length - 1];
    const current = editableState(activeProfile);
    const saved = await saveDraft({ ...activeProfile, ...previous }, false);
    if (!saved) return;
    draftHistory = {
      ...draftHistory,
      [saved.id]: {
        past: history.past.slice(0, -1),
        future: [...history.future, current].slice(-draftHistoryLimit),
      },
    };
    reconcileEditorSelection(saved);
  }
  async function redoEdit() {
    if (!activeProfile || !canRedo) return;
    const history = draftHistory[activeProfile.id];
    const next = history.future[history.future.length - 1];
    const current = editableState(activeProfile);
    const saved = await saveDraft({ ...activeProfile, ...next }, false);
    if (!saved) return;
    draftHistory = {
      ...draftHistory,
      [saved.id]: {
        past: [...history.past, current].slice(-draftHistoryLimit),
        future: history.future.slice(0, -1),
      },
    };
    reconcileEditorSelection(saved);
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
    if (!activeProfile || (kind !== "layers" && !selectedSourceKey)) {
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
    layerRename = activeLayer?.name ?? "";
    behaviorDialog = kind;
  }
  function closeBehaviorDialog() {
    behaviorDialog = null;
  }
  async function assignTapHold() {
    if (
      !tapKey ||
      !holdKey ||
      tapHoldTimeoutMS <= 0 ||
      tapHoldTimeoutMS > 10_000
    )
      return;
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
  async function renameSelectedLayer() {
    if (!activeProfile || !activeLayer || !layerRename.trim()) return;
    const name = layerRename.trim();
    if (
      activeProfile.layers.some(
        (layer) => layer.id !== selectedLayerID && layer.name === name,
      )
    ) {
      feedback = "A layer with that name already exists.";
      return;
    }
    await saveDraft({
      ...activeProfile,
      layers: activeProfile.layers.map((layer) =>
        layer.id === selectedLayerID ? { ...layer, name } : layer,
      ),
    });
  }
  async function moveSelectedLayer(direction: -1 | 1) {
    if (!activeProfile || selectedLayerID === "base") return;
    const index = activeProfile.layers.findIndex(
      (layer) => layer.id === selectedLayerID,
    );
    const destination = index + direction;
    if (
      index < 1 ||
      destination < 1 ||
      destination >= activeProfile.layers.length
    ) {
      return;
    }
    const layers = [...activeProfile.layers];
    [layers[index], layers[destination]] = [layers[destination], layers[index]];
    await saveDraft({ ...activeProfile, layers });
  }
  async function deleteSelectedLayer() {
    if (!activeProfile || selectedLayerID === "base") {
      feedback = "The Base layer is always required.";
      return;
    }
    const ownAssignments =
      activeProfile.assignments?.filter(
        (assignment) => assignment.layer_id === selectedLayerID,
      ).length ?? 0;
    const references = layerEntryCount(selectedLayerID);
    if (ownAssignments || references) {
      feedback = `Remove ${ownAssignments} assignment${ownAssignments === 1 ? "" : "s"} and ${references} layer action${references === 1 ? "" : "s"} before deleting this layer.`;
      return;
    }
    if (
      await saveDraft({
        ...activeProfile,
        layers: activeProfile.layers.filter(
          (layer) => layer.id !== selectedLayerID,
        ),
      })
    ) {
      selectedLayerID = "base";
      layerRename = "";
    }
  }
  function schedulePreview(draft: Profile) {
    if (previewTimer) clearTimeout(previewTimer);
    pendingPreview = null;
    if (keyFlashTimer) clearTimeout(keyFlashTimer);
    const generation = ++previewGeneration;
    previewBusy = true;
    previewTimer = setTimeout(() => {
      previewTimer = undefined;
      queuePreview(draft, generation);
    }, 250);
  }
  function invalidatePreview(recheck: boolean) {
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = undefined;
    pendingPreview = null;
    previewGeneration += 1;
    previewBusy = false;
    profilePreview = null;
    if (recheck && activeProfile) schedulePreview(activeProfile);
  }
  function queuePreview(draft: Profile, generation: number) {
    if (previewInFlight) {
      // One preview at a time protects the manager and makes the latest draft
      // the only queued candidate for this desktop session.
      pendingPreview = { draft, generation };
      return;
    }
    void previewDraft(draft, generation);
  }
  function acceptApplyResult(result: ProfileApplyResult) {
    profiles = profiles.map((profile) =>
      profile.id === result.profile.id ? result.profile : profile,
    );
    if (activeProfile?.id === result.profile.id) {
      activeProfile = result.profile;
      applyOperationProfileID = result.profile.id;
      applyOperation =
        result.uncertain || result.stale || !result.operation.id
          ? null
          : result.operation;
    }
    if (result.profile.apply_pending?.operation_id) {
      followPendingApply(result.profile.id, 1000);
    }
  }
  function followPendingApply(id: string, delayMS: number) {
    if (applyFollowTimers.has(id)) return;
    applyFollowTimers.set(
      id,
      setTimeout(() => {
        applyFollowTimers.delete(id);
        void resumePendingApply(id);
      }, delayMS),
    );
  }
  async function resumePendingApply(id: string) {
    if (resumingApplyIDs.has(id) || !hasDesktopBinding("ResumeApply")) return;
    resumingApplyIDs.add(id);
    try {
      const result = await ResumeApply(id);
      acceptApplyResult(result);
      if (!result.profile.apply_pending) await refresh();
    } catch {
      // Keep the stored request; the next reconnect or manual check retries it.
    } finally {
      resumingApplyIDs.delete(id);
    }
  }
  function resumePendingApplies() {
    if (!workspaceLive) return;
    for (const profile of profiles) {
      if (
        profile.apply_pending?.operation_id ||
        profile.apply_pending?.idempotency_supported
      ) {
        void resumePendingApply(profile.id);
      }
    }
  }
  async function discardLegacyPendingApply() {
    if (!activeProfile?.apply_pending || applyBusy) return;
    try {
      const cleared = await DiscardPendingApply(activeProfile.id);
      acceptApplyResult({ profile: cleared, operation: emptyOperation });
    } catch (error) {
      feedback = explain(error);
    }
  }
  const emptyOperation: Operation = {
    id: "",
    kind: "",
    state: "",
    reason_code: "",
    reason: "",
  };
  function applyOutcomeDetail(operation: Operation) {
    const revision = operation.configuration_revision
      ? ` for configuration revision ${operation.configuration_revision}`
      : "";
    switch (operation.state) {
      case "succeeded":
        return `The manager confirmed activation${revision}.`;
      case "rejected":
        return "The manager rejected this apply. Nothing on the keyboard changed.";
      case "rolled_back":
        return "The new mapping could not start, so the manager restored the previous mapping. See the active revision below.";
      case "failed":
        return operation.reason_code === "runtime_rollback_failed"
          ? "The new mapping could not start and the previous one could not be restored. Check the keyboard card for its current state."
          : "The apply failed. Check the keyboard card for the mapping's current state.";
      case "running":
      case "queued":
        return "The manager is applying this profile. It keeps going even if you close KeyboarDeer.";
      case "cancelled":
        return "The manager cancelled this apply. Check the active revision below for the mapping that remains.";
      default:
        return "";
    }
  }
  async function applyDraft() {
    if (!activeProfile || !canApply || applyBusy) return;
    applyBusy = true;
    feedback = "";
    try {
      const result: ProfileApplyResult = await ApplyProfile(activeProfile.id);
      acceptApplyResult(result);
      await refresh();
      if (result.stale) {
        // Another client changed this keyboard's configuration after review.
        // Nothing was applied; show the refreshed state and ask again.
        applyReviewNotice =
          "This keyboard's mapping was changed on the manager since you reviewed it. KeyboarDeer refreshed the keyboard state and applied nothing. Review your draft and apply again.";
        applyReviewOpen = true;
      }
    } catch (error) {
      feedback = explain(error);
    } finally {
      applyBusy = false;
    }
  }
  // Replays the stored request with its idempotency key: the manager returns
  // the original outcome instead of applying a second time.
  async function checkPendingApply() {
    if (!activeProfile?.apply_pending || applyBusy) return;
    applyBusy = true;
    feedback = "";
    try {
      acceptApplyResult(await ResumeApply(activeProfile.id));
      await refresh();
    } catch (error) {
      feedback = explain(error);
    } finally {
      applyBusy = false;
    }
  }
  function openApplyReview() {
    if (!canApply || applyBusy) return;
    applyReviewNotice = "";
    applyReviewOpen = true;
  }
  async function confirmApply() {
    applyReviewOpen = false;
    await applyDraft();
  }
  async function previewDraft(draft: Profile, generation: number) {
    previewInFlight = true;
    if (
      !capabilities.find(
        (capability) => capability.name === "candidate_validation",
      )?.available
    ) {
      if (generation === previewGeneration) previewBusy = false;
      previewInFlight = false;
      const next = pendingPreview;
      pendingPreview = null;
      if (next) queuePreview(next.draft, next.generation);
      return;
    }
    try {
      const result = await PreviewProfile(draft.id);
      if (
        generation === previewGeneration &&
        activeProfile?.id === result.profile_id &&
        activeProfile.draft_revision === result.draft_revision
      ) {
        profilePreview = result;
        if (
          result.validation.outcome === "valid" &&
          result.validation_recovery
        ) {
          activeProfile = {
            ...activeProfile,
            validation_recovery: result.validation_recovery,
          };
          profiles = profiles.map((profile) =>
            profile.id === activeProfile!.id ? activeProfile! : profile,
          );
        }
      }
    } catch (error) {
      if (
        generation === previewGeneration &&
        activeProfile?.id === draft.id &&
        activeProfile.draft_revision === draft.draft_revision
      ) {
        feedback = explain(error);
      }
    } finally {
      if (generation === previewGeneration) previewBusy = false;
      previewInFlight = false;
      const next = pendingPreview;
      pendingPreview = null;
      if (next) queuePreview(next.draft, next.generation);
    }
  }
  async function pollOperation() {
    if (!operation) return;
    try {
      operation = await IdentifyOperation(operation.id);
      if (operation && terminal(operation.state)) {
        clearPolling();
      } else {
        updateIdentifyCountdown();
      }
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
      operation = await IdentifyStart(selectedDevice.id, identifyTimeoutMS);
      clearPolling();
      identifyDeadlineMS = Date.now() + identifyTimeoutMS;
      updateIdentifyCountdown();
      pollTimer = setInterval(pollOperation, 700);
      identifyCountdownTimer = setInterval(updateIdentifyCountdown, 250);
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
    invalidatePreview(false);
    applyOperation = null;
  }

  function acceptWorkspaceUpdate(next: ManagerWorkspace) {
    const wasLive = workspaceLive;
    const previousServerID = workspace.status.server_id;
    const nextLive = next.status.state === "ready" && !next.stale;
    const environmentChanged =
      wasLive !== nextLive ||
      workspace.status.server_id !== next.status.server_id ||
      workspace.snapshot?.state_revision !== next.snapshot?.state_revision ||
      JSON.stringify(workspace.status.capabilities ?? []) !==
        JSON.stringify(next.status.capabilities ?? []);
    workspace = { ...next, stale: next.stale ?? false };
    if (
      next.status.state === "ready" &&
      !next.stale &&
      (!wasLive || previousServerID !== next.status.server_id)
    ) {
      // Recover accepted work on startup/reconnect, not on every snapshot.
      queueMicrotask(resumePendingApplies);
    }
    if (environmentChanged && activeProfile) {
      invalidatePreview(nextLive);
    }
    if (!identifyOpen || !selectedDevice) return;
    const refreshedDevice = next.snapshot?.devices?.find(
      (device) => device.id === selectedDevice?.id,
    );
    if (!refreshedDevice) {
      feedback =
        "The selected keyboard is no longer reported by the manager. Identification may have ended.";
      return;
    }
    selectedDevice = refreshedDevice;
    if (refreshedDevice.runtime_conflict) {
      feedback =
        "The selected keyboard now has a runtime conflict. The manager may stop identification.";
    } else if (!isConnected(refreshedDevice)) {
      feedback =
        "The selected keyboard disconnected. The manager may stop identification.";
    }
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
        if (isWorkspace(next)) acceptWorkspaceUpdate(next);
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
    for (const timer of applyFollowTimers.values()) clearTimeout(timer);
    applyFollowTimers.clear();
    stopWorkspaceEvents?.();
  });
</script>

<svelte:head><title>{info.name}</title></svelte:head>
<svelte:window
  bind:innerHeight={viewportHeight}
  on:keydown={handleGlobalKeydown}
/>

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
        class:attention={workspace.status.state !== "ready" || workspace.stale}
        class="connection-status"
      >
        <i></i>{workspace.stale
          ? "Manager state stale"
          : workspace.status.state === "ready"
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

        {#if workspace.stale}
          <section
            class="manager-notice"
            data-state="stale"
            aria-labelledby="manager-title"
          >
            <span class="notice-symbol" aria-hidden="true">!</span>
            <div>
              <p class="eyebrow">LAST KNOWN MANAGER STATE</p>
              <h2 id="manager-title">Keyboard status may be out of date</h2>
              <p>
                {workspace.status.message} KeyboarDeer is showing the last authoritative
                snapshot and will refresh it when the manager is reachable again.
              </p>
              {#if workspace.snapshot_at}<small
                  >Last snapshot: {new Date(
                    workspace.snapshot_at,
                  ).toLocaleString()}</small
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
              <p>
                Contacting the local manager for the current device snapshot.
              </p>
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

        {#if profileStoreProblem}
          <section
            class="manager-notice"
            data-state="profile-store"
            aria-labelledby="profile-store-title"
          >
            <span class="notice-symbol" aria-hidden="true">!</span>
            <div>
              <p class="eyebrow">SAVED DRAFTS</p>
              <h2 id="profile-store-title">
                {profileStoreProblem.state === "unsupported"
                  ? "Drafts need a newer KeyboarDeer"
                  : "Saved drafts could not be loaded"}
              </h2>
              <p>{profileStoreProblem.message}</p>
              {#if profileStoreProblem.path}<small
                  >File: {profileStoreProblem.path}</small
                >{/if}
              {#if profileStoreProblem.state === "corrupt"}
                <p>
                  Running mappings are unaffected. You can keep the damaged file
                  as a backup and start with an empty draft list.
                </p>
                <Button
                  variant="primary"
                  className="store-recovery"
                  type="button"
                  on:click={recoverProfileStore}
                  >{confirmStoreReset
                    ? "Confirm: back up and start fresh"
                    : "Back up and start fresh"}</Button
                >
              {/if}
            </div>
          </section>
        {/if}
        {#if storeRecoveryMessage}<p class="inline-feedback" role="status">
            {storeRecoveryMessage}
          </p>{/if}
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
              <article
                class:offline={!isConnected(device)}
                class:attention={deviceState(device) !== "connected"}
                class="device-card"
              >
                <div class="device-glyph" aria-hidden="true">⌨</div>
                <div class="device-copy">
                  <div class="device-title">
                    <h2>{device.display_name || "Unnamed keyboard"}</h2>
                    <span
                      class:connected={isConnected(device)}
                      class="availability">{humanize(deviceState(device))}</span
                    >
                  </div>
                  <p>
                    {device.reason ||
                      "The manager did not provide a display explanation."}
                  </p>
                  {#if deviceState(device) !== "connected"}
                    <small class="device-state-summary"
                      >{deviceStateSummary(device)}</small
                    >
                  {/if}
                  {#if profileForDevice(device)}
                    {@const deviceProfiles = profilesForDevice(device.id)}
                    <small class="device-profile-summary"
                      >Profile: {profileForDevice(device)
                        ?.name}{deviceProfiles.length > 1
                        ? ` · ${deviceProfiles.length} profiles`
                        : ""}</small
                    >
                  {/if}
                  {#each deviceConfigurations as configuration (configuration.id)}
                    {@const lastOperation =
                      operationForConfiguration(configuration)}
                    <section
                      class:unhealthy={!configuration.runtime.healthy &&
                        configuration.enabled}
                      class="configuration-state"
                    >
                      <strong
                        >{configuration.name || "Unnamed configuration"}</strong
                      >
                      <span
                        >{humanize(configuration.ownership)} configuration</span
                      >
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
                          <dd>{runtimeHealthLabel(configuration)}</dd>
                        </div>
                      </dl>
                      <small>{runtimeHealthDetail(configuration)}</small>
                      {#if lastOperation}<small class="configuration-operation"
                          >Latest manager operation: {humanize(
                            lastOperation.state,
                          )}
                          — {lastOperation.reason}</small
                        >{/if}
                      {#if configuration.ownership === "managed"}
                        {#if confirmConfigurationDeleteID === configuration.id}
                          <p class="configuration-delete-warning" role="alert">
                            This stops the mapping on this keyboard and removes
                            it from the manager. Your KeyboarDeer profiles are
                            kept and can be applied again.
                          </p>
                        {/if}
                        <div class="configuration-actions">
                          {#if confirmConfigurationDeleteID === configuration.id}
                            <Button
                              variant="secondary"
                              type="button"
                              on:click={() =>
                                (confirmConfigurationDeleteID = "")}
                              >Keep mapping</Button
                            >
                          {/if}
                          <Button
                            variant="secondary"
                            className="configuration-delete"
                            type="button"
                            on:click={() => deleteConfiguration(configuration)}
                            disabled={!!lifecycleBusyID ||
                              !workspaceLive ||
                              !managedConfigurations.available}
                            title={managedConfigurations.available
                              ? "Stop this mapping and remove it from the manager"
                              : managedConfigurations.reason}
                            >{lifecycleBusyID === configuration.id
                              ? "Removing…"
                              : confirmConfigurationDeleteID ===
                                  configuration.id
                                ? "Confirm: remove from keyboard"
                                : "Remove from keyboard"}</Button
                          >
                        </div>
                      {/if}
                    </section>
                  {/each}
                </div>
                <div class="device-actions">
                  <Button
                    variant="text"
                    className="identify-trigger"
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
                    </svg></Button
                  >
                  <Button
                    variant="primary"
                    on:click={() => openDraft(device)}
                    disabled={!workspaceLive ||
                      !isConfigurable(device) ||
                      geometries.length === 0 ||
                      !!profileStoreProblem}
                    title={profileStoreProblem
                      ? "Saved drafts must be recovered before editing."
                      : geometries.length === 0
                        ? "Loading verified keyboard geometries."
                        : profileForDevice(device)
                          ? "Open this local keyboard draft"
                          : "Create a local keyboard draft"}
                    >{profileForDevice(device)
                      ? "Edit draft"
                      : "Set up"}</Button
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
                          !workspaceLive ||
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
                <Button
                  variant="text"
                  className="identify-trigger"
                  aria-label="Identify"
                  title="Device discovery is unavailable"
                  disabled
                  ><svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 4a8 8 0 1 1-8 8" />
                    <path d="M12 8a4 4 0 1 1-4 4" />
                    <path d="M4 4l8 8" />
                    <circle cx="12" cy="12" r="1.5" />
                  </svg></Button
                ><Button variant="primary" disabled>Set up</Button>
              </div>
            </article>
          </section>
        {/if}
        {#if configurations.filter((configuration) => configuration.ownership === "external").length}
          <section
            class="external-configurations"
            aria-labelledby="external-title"
          >
            <div class="external-heading">
              <div>
                <p class="eyebrow">MANAGER-SUPERVISED</p>
                <h2 id="external-title">External configurations</h2>
              </div>
              <span class="build-label">READ ONLY</span>
            </div>
            <p>
              These mappings are owned outside KeyboarDeer. Runtime details come
              from the manager; editing their raw KMonad source is unavailable.
            </p>
            <div class="external-configuration-list">
              {#each configurations.filter((configuration) => configuration.ownership === "external") as configuration (configuration.id)}
                {@const lastOperation =
                  operationForConfiguration(configuration)}
                <article class="external-configuration">
                  <div>
                    <h3>
                      {configuration.name || "Unnamed external configuration"}
                    </h3>
                    <span>{runtimeHealthLabel(configuration)}</span>
                  </div>
                  <dl>
                    <div>
                      <dt>Runtime</dt>
                      <dd>{humanize(configuration.runtime.phase)}</dd>
                    </div>
                    <div>
                      <dt>Desired / active</dt>
                      <dd>
                        {configuration.desired_revision} / {configuration.active_revision}
                      </dd>
                    </div>
                  </dl>
                  <p>{runtimeHealthDetail(configuration)}</p>
                  {#if lastOperation}<small
                      >Latest manager operation: {humanize(lastOperation.state)}
                      — {lastOperation.reason}</small
                    >{/if}
                </article>
              {/each}
            </div>
            <Button
              variant="secondary"
              className="external-open"
              on:click={() => (externalOpen = true)}
              >View external configuration details</Button
            >
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
        <Button variant="link" on:click={backToDevices}>← All keyboards</Button>
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
            <Button variant="secondary" type="button" on:click={backToDevices}
              >Cancel</Button
            >
            <Button
              variant="primary"
              type="submit"
              disabled={profileBusy || !selectedGeometryID}
              >{profileBusy ? "Creating…" : "Create draft"}</Button
            >
          </div>
        </form>
        {#if feedback}<p class="inline-feedback" role="status">
            {feedback}
          </p>{/if}
      </section>
    {:else if view === "editor" && activeProfile}
      <section
        class="editor-page"
        class:compact-palette={compactPalette}
        aria-labelledby="editor-title"
      >
        <div class="editor-heading">
          <nav aria-label="Editor breadcrumb">
            <Button variant="link" on:click={backToDevices}
              >← All keyboards</Button
            >
            <Button
              variant="secondary"
              className="profiles-trigger"
              type="button"
              on:click={openProfiles}
              title="Switch, rename, duplicate, or delete profiles"
              >Profiles{selectedDevice &&
              profilesForDevice(selectedDevice.id).length > 1
                ? ` (${profilesForDevice(selectedDevice.id).length})`
                : ""}</Button
            >
          </nav>
          <div class="editor-title">
            <h1 id="editor-title">{activeProfile.name}</h1>
            <span>{selectedDevice?.display_name ?? "Keyboard"}</span>
          </div>
          <span class="draft-status" data-state={draftSaveState} role="status"
            >{draftStatusText}</span
          >
          <div class="history-actions">
            <Button
              variant="secondary"
              className="history-button"
              type="button"
              on:click={undoEdit}
              disabled={!canUndo}
              aria-label="Undo"
              title="Undo (Ctrl+Z)">↶</Button
            >
            <Button
              variant="secondary"
              className="history-button"
              type="button"
              on:click={redoEdit}
              disabled={!canRedo}
              aria-label="Redo"
              title="Redo (Ctrl+Shift+Z)">↷</Button
            >
          </div>
          <span
            class="configuration-indicator"
            data-state={validationState}
            role="img"
            aria-label={validationLabel}
            title={validationLabel}
            ><i></i>{#if validationState === "valid"}Valid configuration{/if}</span
          >
          <Button
            variant="primary"
            className="editor-apply"
            type="button"
            on:click={openApplyReview}
            disabled={!canApply || applyBusy}
            title={canApply
              ? "Apply this validated draft to the keyboard"
              : "Apply requires a current valid manager preview, a connected keyboard, and the managed-configurations capability."}
            >{applyBusy ? "Applying…" : "Apply to keyboard"}</Button
          >
          <Button
            variant="secondary"
            type="button"
            on:click={viewRawConfiguration}
            disabled={rawConfigurationBusy ||
              !activeProfile.manager_configuration_id ||
              !workspaceLive ||
              !configurationExport.available ||
              !hasDesktopBinding("ExportConfiguration")}
            title={!activeProfile.manager_configuration_id
              ? "Apply this profile before viewing its manager-rendered KMonad configuration."
              : !configurationExport.available
                ? configurationExport.reason
                : "View the manager-rendered KMonad configuration for this keyboard."}
            >{rawConfigurationBusy ? "Loading .kbd…" : "View .kbd"}</Button
          >
        </div>
        {#if activeGeometry}
          <div class="editor-scroll-region">
            <div class="keyboard-editor" aria-label={activeGeometry.name}>
              {#if currentPreview && currentPreview.validation.outcome !== "valid"}
                <aside
                  class:blocked={currentPreview.validation.outcome ===
                    "blocked"}
                  class="preview-message"
                  aria-live="polite"
                >
                  <strong
                    >Preview {humanize(
                      currentPreview.validation.outcome,
                    )}</strong
                  >
                  <p>{currentPreview.validation.reason}</p>
                  {#if currentPreview.validation.outcome === "rejected"}
                    {#if mappedPreviewIssues.length === 0}
                      <p>
                        No keyboard mapping has been applied. No exact manager
                        location matched one assignment, so KeyboarDeer will not
                        guess a key or offer a targeted revert.
                      </p>
                    {:else}
                      <p>
                        No keyboard mapping has been applied. The exact manager
                        locations below are mapped to this draft only.
                      </p>
                    {/if}
                  {:else if currentPreview.validation.outcome === "blocked"}
                    <p>
                      This is an environmental blockage, not an invalid key
                      assignment. Editing remains available while the manager or
                      keyboard recovers.
                    </p>
                  {/if}
                  {#if currentPreview.validation.diagnostics?.length}
                    <ul class="validation-diagnostics">
                      {#each currentPreview.validation.diagnostics as diagnostic (diagnostic.id)}
                        {@const issue = diagnosticIssue(diagnostic.id)}
                        {@const recovery = issue
                          ? recoveryForIssue(issue)
                          : null}
                        <li>
                          <strong>{diagnosticResourceLabel(diagnostic)}</strong>
                          <span>{diagnostic.summary}</span>
                          {#if diagnostic.remediation}<small
                              >{diagnostic.remediation}</small
                            >{/if}
                          {#if issue}
                            <div class="validation-issue-actions">
                              <Button
                                variant="text"
                                type="button"
                                on:click={() => showMappedIssue(issue)}
                                >Show {layerName(issue.layerID)} · {issue.sourceKey}</Button
                              >
                              {#if recovery?.available}
                                <Button
                                  variant="secondary"
                                  type="button"
                                  on:click={() =>
                                    revertMappedIssue(diagnostic.id)}
                                  disabled={profileBusy ||
                                    !!activeProfile?.apply_pending}
                                  >Revert {issue.sourceKey}</Button
                                >
                              {/if}
                            </div>
                            {#if recovery?.reason}<small
                                >{recovery.reason}</small
                              >{/if}
                          {/if}
                        </li>
                      {/each}
                    </ul>
                  {/if}
                </aside>
              {/if}
              {#each activeRows as row}
                <div class="keyboard-row">
                  {#each activeGeometry.keys.filter((key) => key.row === row) as key (key.id)}
                    <Button
                      variant="key"
                      className={`${selectedLayerBehaviors[key.source_key]?.kind === "disabled" ? "disabled-key " : ""}${selectedSourceKey === key.source_key ? "selected-key " : ""}${mappedPreviewIssues.some((issue) => issue.layerID === selectedLayerID && issue.sourceKey === key.source_key) ? "invalid-key " : ""}${flashingSourceKey === key.source_key ? "flashing-key" : ""}`}
                      style={`width: ${key.width * 42}px; margin-left: ${(key.gap_before ?? 0) * 42}px`}
                      data-issue-key
                      data-layer-id={selectedLayerID}
                      data-source-key={key.source_key}
                      title={selectedLayerBehaviors[key.source_key]?.kind ===
                      "disabled"
                        ? `Disabled on ${activeLayer?.name ?? "current"} layer: this key sends no input and blocks lower layers.`
                        : undefined}
                      on:click={() =>
                        (selectedSourceKey =
                          selectedSourceKey === key.source_key
                            ? ""
                            : key.source_key)}
                      aria-pressed={selectedSourceKey === key.source_key}
                    >
                      <strong>{key.label}</strong><small
                        >{behaviorLabel(
                          selectedLayerBehaviors[key.source_key],
                          key.source_key,
                        )}</small
                      >
                    </Button>
                  {/each}
                </div>
              {/each}
            </div>
            {#if activeProfile.layers.length > 1}
              <section
                class="layer-guidance"
                aria-labelledby="layer-guidance-title"
              >
                <strong id="layer-guidance-title">Layer entry and exit</strong>
                <p>
                  Assign a <b>Hold layer</b> or <b>Switch layer</b> action on a reachable
                  key to enter an overlay. Hold layers end when that key is released.
                  Switched layers remain active until another Switch layer action—normally
                  one targeting Base—changes them.
                </p>
                {#each activeProfile.layers.filter((layer) => !layerIsReachable(layer.id)) as layer (layer.id)}
                  <small>{layer.name} has no entry action yet.</small>
                {/each}
              </section>
            {/if}
            {#if activeProfile.apply_pending?.idempotency_supported || activeProfile.apply_pending?.operation_id}
              <div class="apply-status apply-pending" role="status">
                {#if activeProfile.apply_pending.operation_id}
                  <p>
                    The manager accepted this apply. KeyboarDeer is tracking its
                    final outcome; closing the app will not cancel the manager's
                    work.
                  </p>
                {:else}
                  <p>
                    The manager has not confirmed the Apply sent at {new Date(
                      activeProfile.apply_pending.started_at,
                    ).toLocaleString()}. KeyboarDeer kept the exact request and
                    can safely check again without applying it twice.
                  </p>
                {/if}
                <Button
                  variant="secondary"
                  type="button"
                  on:click={checkPendingApply}
                  disabled={applyBusy}
                  >{applyBusy ? "Checking…" : "Check apply outcome"}</Button
                >
                {#if activeProfile.apply_pending.operation_id}
                  <Button
                    variant="secondary"
                    className="legacy-discard"
                    type="button"
                    on:click={discardLegacyPendingApply}
                    disabled={applyBusy}
                    >I checked the keyboard — clear unresolved apply</Button
                  >
                {/if}
              </div>
            {:else if activeProfile.apply_pending}
              <p class="apply-status">
                An Apply sent at {new Date(
                  activeProfile.apply_pending.started_at,
                ).toLocaleString()} has an unknown outcome. The manager version that
                received it does not guarantee durable idempotency, so KeyboarDeer
                will not replay it. Check the keyboard card before continuing.
              </p>
              <Button
                variant="secondary"
                className="legacy-discard"
                type="button"
                on:click={discardLegacyPendingApply}
                >I checked the keyboard — continue editing</Button
              >
            {:else if shownApplyOperation}
              <div
                class="apply-status apply-outcome"
                data-state={shownApplyOperation.state}
                role="status"
              >
                <p>
                  Manager Apply: {humanize(shownApplyOperation.state)} —
                  {shownApplyOperation.reason}
                </p>
                {#if applyOutcomeDetail(shownApplyOperation)}<p>
                    {applyOutcomeDetail(shownApplyOperation)}
                  </p>{/if}
              </div>
            {/if}
            {#if linkedConfiguration}
              <p class="apply-status active-revision">
                Manager-reported active revision:
                {linkedConfiguration.active_revision || "none"} · desired revision
                {linkedConfiguration.desired_revision} · runtime:
                {runtimeHealthLabel(linkedConfiguration).toLowerCase()}.
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
                  >{activeLayer
                    ? `${activeLayer.name} layer`
                    : "No active layer"}</span
                >
                {#if activeLayer && !layerIsReachable(activeLayer.id)}
                  <em>Needs an entry action</em>
                {/if}
              </div>
              <div class="layer-tabs" role="tablist" aria-label="Keymap layers">
                {#each activeProfile.layers as layer (layer.id)}
                  <Button
                    variant="secondary"
                    className={`layer-tab${selectedLayerID === layer.id ? " active" : ""}${!layerIsReachable(layer.id) ? " unreachable" : ""}`}
                    role="tab"
                    aria-selected={selectedLayerID === layer.id}
                    on:click={() => (selectedLayerID = layer.id)}
                    title={layerIsReachable(layer.id)
                      ? `${layer.name} layer`
                      : `${layer.name} has no entry action`}
                    >{layer.name}</Button
                  >
                {/each}
                <Button
                  variant="secondary"
                  className="layer-tab"
                  on:click={() => openBehaviorDialog("layers")}
                  title="Manage layers">Manage</Button
                >
              </div>
              <div class="complex-actions">
                <Button
                  variant="secondary"
                  on:click={() => openBehaviorDialog("tap_hold")}
                  disabled={!selectedSourceKey || profileBusy}
                  >Tap &amp; hold</Button
                >
                <Button
                  variant="secondary"
                  on:click={() => openBehaviorDialog("layer")}
                  disabled={!selectedSourceKey || profileBusy}
                  >Layer action</Button
                >
                <Button
                  variant="secondary"
                  on:click={() => openBehaviorDialog("alias")}
                  disabled={!selectedSourceKey || profileBusy}>Alias</Button
                >
                <Button
                  variant="secondary"
                  on:click={() => openBehaviorDialog("macro")}
                  disabled={!selectedSourceKey || profileBusy}>Macro</Button
                >
                {#each Object.keys(activeProfile.aliases ?? {}).sort() as name}
                  <Button
                    variant="secondary"
                    className="declaration-action"
                    on:click={() =>
                      assignBehavior({ kind: "alias", target: name })}
                    disabled={!selectedSourceKey || profileBusy}
                    title={`Assign alias ${name}`}>@{name}</Button
                  >
                {/each}
                {#each Object.keys(activeProfile.macros ?? {}).sort() as name}
                  <Button
                    variant="secondary"
                    className="declaration-action"
                    on:click={() =>
                      assignBehavior({ kind: "macro", target: name })}
                    disabled={!selectedSourceKey || profileBusy}
                    title={`Assign macro ${name}`}>#{name}</Button
                  >
                {/each}
              </div>
            </div>
            <div class="palette-search">
              <label for="palette-search">Search keys</label>
              <input
                id="palette-search"
                type="search"
                bind:value={keySearch}
                placeholder="Name or KMonad code"
                autocomplete="off"
              />
              {#if normalizedKeySearch}<span
                  >{visiblePaletteKeys.length} of {paletteKeyOptions.length}</span
                >{/if}
            </div>
            <div
              class="palette-categories"
              role="tablist"
              aria-label="Key categories"
            >
              {#each paletteCategories as category (category.id)}
                <Button
                  variant="secondary"
                  className={`palette-category${activePaletteCategory === category.id ? " active" : ""}`}
                  role="tab"
                  aria-selected={activePaletteCategory === category.id}
                  on:click={() => (activePaletteCategory = category.id)}
                  >{category.label}</Button
                >
              {/each}
            </div>
            <div class="palette-buttons">
              {#each renderedPaletteKeys as key, index (key.source_key)}
                {#if !compactPalette && !normalizedKeySearch && (index === 0 || paletteKeyGroup(renderedPaletteKeys[index - 1]) !== paletteKeyGroup(key)) && paletteKeyGroup(key) >= 3}
                  <h3 class="palette-group-heading">
                    {paletteGroupLabel(paletteKeyGroup(key))}
                  </h3>
                {/if}
                <Button
                  variant="palette"
                  on:click={() =>
                    assignBehavior({
                      kind: "key",
                      key: key.source_key,
                    })}
                  disabled={profileBusy || !selectedSourceKey}
                  title={`Assign ${key.label} (${key.source_key})`}
                  ><span>{paletteLabel(key)}</span><small
                    >{key.source_key}</small
                  ></Button
                >
              {:else}
                <p class="palette-empty">
                  {normalizedKeySearch
                    ? `No keys match “${keySearch.trim()}”.`
                    : "No keys in this category."}
                </p>
              {/each}
              <div class="palette-utility">
                <Button
                  variant="secondary"
                  className="palette-disable"
                  on:click={() => assignBehavior({ kind: "disabled" })}
                  disabled={profileBusy || !selectedSourceKey}
                  >Disable selected key</Button
                >
                <Button
                  variant="secondary"
                  className="palette-restore"
                  on:click={restoreSelectedKey}
                  disabled={profileBusy || !selectedSourceKey}
                  >Restore original</Button
                >
                <Button
                  variant="secondary"
                  on:click={() => assignBehavior({ kind: "transparent" })}
                  disabled={profileBusy ||
                    !selectedSourceKey ||
                    selectedLayerID === "base"}
                  title={selectedLayerID === "base"
                    ? "The Base layer cannot fall through."
                    : "Let this key fall through to the lower layer."}
                  >Pass through</Button
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
        <Button
          variant="icon"
          className="behavior-dialog-close"
          on:click={closeBehaviorDialog}
          aria-label="Close complex action dialog"
          title="Close">×</Button
        >
        <p class="eyebrow">COMPLEX ACTION · {selectedSourceKey}</p>
        {#if behaviorDialog === "layers"}
          <h2 id="behavior-dialog-title">Manage layers</h2>
          <p class="dialog-intro">
            Layers without an entry action cannot be reached from the keyboard.
            Add a Hold layer or Switch layer action before applying this draft.
          </p>
          <div class="new-layer-control">
            <label for="manage-new-layer-name">Add a layer</label>
            <div>
              <input
                id="manage-new-layer-name"
                bind:value={newLayerName}
                maxlength="40"
                placeholder="Navigation"
              />
              <Button
                variant="secondary"
                type="button"
                disabled={profileBusy || !newLayerName.trim()}
                on:click={createLayer}>Add layer</Button
              >
            </div>
            <small
              >The new layer is selected automatically; add a layer action to
              make it reachable.</small
            >
          </div>
          <div class="layer-manager-list" aria-label="Layers">
            {#each activeProfile.layers as layer, index (layer.id)}
              <Button
                variant="plain"
                className={`${selectedLayerID === layer.id ? "active " : ""}${!layerIsReachable(layer.id) ? "unreachable" : ""}`}
                on:click={() => {
                  selectedLayerID = layer.id;
                  layerRename = layer.name;
                }}
                >{layer.name}<small
                  >{layerIsReachable(layer.id)
                    ? "Reachable"
                    : "No entry action"}</small
                ></Button
              >
              {#if index === 0}<span class="layer-manager-base">Required</span
                >{/if}
            {/each}
          </div>
          <form
            class="behavior-form"
            on:submit|preventDefault={renameSelectedLayer}
          >
            <label for="rename-layer">Rename selected layer</label>
            <input
              id="rename-layer"
              bind:value={layerRename}
              maxlength="40"
              required
            />
            <div class="layer-manager-actions">
              <Button
                variant="secondary"
                type="button"
                disabled={selectedLayerIndex <= 1 || profileBusy}
                title={selectedLayerIndex <= 1
                  ? "Base is fixed at the beginning of the layer order."
                  : "Move this layer earlier in the order."}
                on:click={() => moveSelectedLayer(-1)}>Move earlier</Button
              >
              <Button
                variant="secondary"
                type="button"
                disabled={selectedLayerIndex < 1 ||
                  selectedLayerIndex >= activeProfile.layers.length - 1 ||
                  profileBusy}
                title={selectedLayerIndex >= activeProfile.layers.length - 1
                  ? "This layer is already last."
                  : selectedLayerID === "base"
                    ? "Base is fixed at the beginning of the layer order."
                    : "Move this layer later in the order."}
                on:click={() => moveSelectedLayer(1)}>Move later</Button
              >
              <Button
                variant="secondary"
                type="button"
                disabled={selectedLayerID === "base" ||
                  selectedLayerAssignments > 0 ||
                  selectedLayerReferences > 0 ||
                  profileBusy}
                title={selectedLayerID === "base"
                  ? "The Base layer is required."
                  : selectedLayerAssignments || selectedLayerReferences
                    ? `Remove ${selectedLayerAssignments} assignment(s) and ${selectedLayerReferences} layer action(s) first.`
                    : "Delete this empty, unreferenced layer."}
                on:click={deleteSelectedLayer}>Delete layer</Button
              >
            </div>
            <div class="behavior-form-actions">
              <Button
                variant="secondary"
                type="button"
                on:click={closeBehaviorDialog}>Close</Button
              >
              <Button
                variant="primary"
                disabled={profileBusy ||
                  !layerRename.trim() ||
                  activeProfile.layers.some(
                    (layer) =>
                      layer.id !== selectedLayerID &&
                      layer.name === layerRename.trim(),
                  )}
                title={activeProfile.layers.some(
                  (layer) =>
                    layer.id !== selectedLayerID &&
                    layer.name === layerRename.trim(),
                )
                  ? "Layer names must be unique."
                  : "Save the selected layer name."}
                type="submit">Rename layer</Button
              >
            </div>
          </form>
        {:else if behaviorDialog === "tap_hold"}
          <h2 id="behavior-dialog-title">Tap &amp; hold</h2>
          <p class="dialog-intro">
            Choose what happens for a quick tap and what happens while the key
            is held. The manager validates the complete draft before it can be
            applied.
          </p>
          <p class="timing-explanation">
            <strong>{defaultTapHoldTimeoutMS} ms default:</strong> release before
            the timeout to send the tap action; keep holding beyond it to use the
            hold action. A held layer stays active only while this key remains pressed.
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
              max="10000"
              required
            />
            <div class="behavior-form-actions">
              <Button
                variant="secondary"
                type="button"
                on:click={closeBehaviorDialog}>Cancel</Button
              >
              <Button variant="primary" disabled={profileBusy} type="submit"
                >Assign tap &amp; hold</Button
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
                <Button
                  variant="secondary"
                  type="button"
                  disabled={profileBusy || !newLayerName.trim()}
                  on:click={createLayer}>Add layer</Button
                >
              </div>
            </div>
            <div class="behavior-form-actions">
              <Button
                variant="secondary"
                type="button"
                on:click={closeBehaviorDialog}>Cancel</Button
              >
              <Button variant="primary" disabled={profileBusy} type="submit"
                >Assign layer action</Button
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
              <Button
                variant="secondary"
                type="button"
                on:click={closeBehaviorDialog}>Cancel</Button
              >
              <Button variant="primary" disabled={profileBusy} type="submit"
                >Create and assign alias</Button
              >
            </div>
          </form>
        {:else}
          <h2 id="behavior-dialog-title">Macro sequence</h2>
          <p class="dialog-intro">
            Build an ordered sequence of key presses. It will be saved as a
            named macro and assigned to the selected key.
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
              <Button variant="secondary" type="button" on:click={addMacroStep}
                >Add</Button
              >
            </div>
            <ol class="macro-steps" aria-label="Macro key sequence">
              {#each macroSteps as step, index (`${step}-${index}`)}
                <li>
                  <span>{step}</span>
                  <Button
                    variant="plain"
                    className="macro-remove"
                    type="button"
                    on:click={() =>
                      (macroSteps = macroSteps.filter(
                        (_, stepIndex) => stepIndex !== index,
                      ))}>Remove</Button
                  >
                </li>
              {/each}
            </ol>
            <div class="behavior-form-actions">
              <Button
                variant="secondary"
                type="button"
                on:click={closeBehaviorDialog}>Cancel</Button
              >
              <Button
                variant="primary"
                disabled={profileBusy || !macroSteps.length}
                type="submit">Create and assign macro</Button
              >
            </div>
          </form>
        {/if}
      </dialog>
    </div>
  {/if}
  {#if profilesOpen && activeProfile && selectedDevice}
    <div class="behavior-dialog-backdrop">
      <dialog class="behavior-dialog" open aria-labelledby="profiles-title">
        <Button
          variant="icon"
          className="behavior-dialog-close"
          on:click={closeProfiles}
          aria-label="Close profiles"
          title="Close">×</Button
        >
        <p class="eyebrow">
          PROFILES · {selectedDevice.display_name || "Keyboard"}
        </p>
        <h2 id="profiles-title">Profiles</h2>
        <p class="dialog-intro">
          Each profile is a separate draft for this keyboard. Switching saves
          nothing extra and applies nothing; use Apply to send a profile to the
          keyboard. Import and export share portable behavior data, not runnable
          device-specific .kbd files.
        </p>
        <ul class="profile-list" aria-label="Profiles for this keyboard">
          {#each profilesForDevice(selectedDevice.id) as candidate (candidate.id)}
            <li class:active={candidate.id === activeProfile.id}>
              <div>
                <strong>{candidate.name}</strong>
                <small
                  >{candidate.manager_configuration_id
                    ? "Applied to keyboard"
                    : "Draft only"}</small
                >
              </div>
              {#if candidate.id === activeProfile.id}
                <span class="profile-current">Editing</span>
              {:else}
                <Button
                  variant="secondary"
                  type="button"
                  on:click={() => switchProfile(candidate)}
                  disabled={profileBusy}
                  aria-label={`Open ${candidate.name}`}>Open</Button
                >
              {/if}
            </li>
          {/each}
        </ul>
        <form
          class="behavior-form"
          on:submit|preventDefault={renameActiveProfile}
        >
          <label for="profile-rename">Rename this profile</label>
          <input
            id="profile-rename"
            bind:value={profileRename}
            maxlength="80"
            required
          />
          <Button
            variant="secondary"
            type="submit"
            disabled={profileBusy ||
              !profileRename.trim() ||
              profileRename.trim() === activeProfile.name}
            >Rename profile</Button
          >
        </form>
        {#if confirmProfileDelete}
          <p class="profile-delete-warning" role="alert">
            Delete “{activeProfile.name}” from KeyboarDeer?
            {activeProfile.manager_configuration_id
              ? "The mapping already applied to this keyboard keeps running. To stop it, use Remove from keyboard on the keyboard card."
              : "This draft has not been applied."}
          </p>
        {/if}
        <div class="behavior-form-actions">
          <Button
            variant="secondary"
            type="button"
            on:click={importProfileForDevice}
            disabled={profileBusy || !hasDesktopBinding("ImportProfile")}
            >Import</Button
          >
          <Button
            variant="secondary"
            type="button"
            on:click={exportActiveProfile}
            disabled={profileBusy || !hasDesktopBinding("ExportProfile")}
            >Export</Button
          >
          <Button
            variant="secondary"
            type="button"
            on:click={newProfileForDevice}
            disabled={profileBusy}>New profile</Button
          >
          <Button
            variant="secondary"
            type="button"
            on:click={duplicateActiveProfile}
            disabled={profileBusy}>Duplicate</Button
          >
          <Button
            variant="secondary"
            className="profile-delete"
            type="button"
            on:click={deleteActiveProfile}
            disabled={profileBusy || !!activeProfile.apply_pending}
            >{confirmProfileDelete
              ? "Confirm delete"
              : "Delete profile"}</Button
          >
        </div>
      </dialog>
    </div>
  {/if}
  {#if applyReviewOpen && activeProfile}
    <div class="behavior-dialog-backdrop">
      <dialog class="behavior-dialog" open aria-labelledby="apply-review-title">
        <Button
          variant="icon"
          className="behavior-dialog-close"
          on:click={() => (applyReviewOpen = false)}
          aria-label="Close apply review"
          title="Close">×</Button
        >
        <p class="eyebrow">REVIEW &amp; APPLY</p>
        <h2 id="apply-review-title">Ready to send this draft?</h2>
        {#if applyReviewNotice}
          <p class="apply-review-notice" role="alert">{applyReviewNotice}</p>
        {/if}
        <p class="dialog-intro">
          The manager will render, validate, persist, and supervise this
          profile. Nothing changes until you confirm.
        </p>
        <ul class="apply-review-list">
          {#each activeProfile.assignments ?? [] as assignment (`${assignment.layer_id}-${assignment.source_key}`)}
            <li>
              <strong
                >{layerName(assignment.layer_id)} · {assignment.source_key}</strong
              >
              <span>{behaviorSummary(assignment.behavior)}</span>
            </li>
          {:else}
            <li>
              <span
                >No explicit assignments; the original Base layout will be
                applied.</span
              >
            </li>
          {/each}
        </ul>
        <div class="behavior-form-actions">
          <Button
            variant="secondary"
            type="button"
            on:click={() => (applyReviewOpen = false)}>Keep editing</Button
          >
          <Button
            variant="primary"
            type="button"
            on:click={confirmApply}
            disabled={!canApply || applyBusy}
            title={canApply
              ? "Send this draft to the keyboard"
              : "Waiting for a current valid preview of the refreshed keyboard state."}
            >Apply to keyboard</Button
          >
        </div>
      </dialog>
    </div>
  {/if}
  {#if externalOpen}
    <div class="behavior-dialog-backdrop">
      <dialog
        class="behavior-dialog external-dialog"
        open
        aria-labelledby="external-dialog-title"
      >
        <Button
          variant="icon"
          className="behavior-dialog-close"
          on:click={() => (externalOpen = false)}
          aria-label="Close external configuration details"
          title="Close">×</Button
        >
        <p class="eyebrow">MANAGER-SUPERVISED · READ ONLY</p>
        <h2 id="external-dialog-title">External configurations</h2>
        <p class="dialog-intro">
          These configurations are not KeyboarDeer profiles. Their runtime state
          is reported by the manager and cannot be edited here.
        </p>
        <div class="external-detail-list">
          {#each configurations.filter((configuration) => configuration.ownership === "external") as configuration (configuration.id)}
            {@const lastOperation = operationForConfiguration(configuration)}
            <article>
              <h3>{configuration.name || "Unnamed external configuration"}</h3>
              <p>{runtimeHealthDetail(configuration)}</p>
              {#if lastOperation}<small
                  >Latest manager operation: {humanize(lastOperation.state)} —
                  {lastOperation.reason}</small
                >{/if}
            </article>
          {/each}
        </div>
        <section class="raw-external-unavailable">
          <strong>Raw KMonad source is unavailable</strong>
          <p>
            The manager has not provided an access-controlled content API, so
            KeyboarDeer does not read manager-owned files directly.
          </p>
        </section>
      </dialog>
    </div>
  {/if}
  {#if rawConfigurationOpen && rawConfiguration}
    <div class="behavior-dialog-backdrop">
      <dialog
        class="behavior-dialog raw-configuration-dialog"
        open
        aria-labelledby="raw-configuration-title"
      >
        <Button
          variant="icon"
          className="behavior-dialog-close"
          on:click={() => (rawConfigurationOpen = false)}
          aria-label="Close KMonad configuration"
          title="Close">×</Button
        >
        <p class="eyebrow">MANAGER-RENDERED · DEVICE-BOUND</p>
        <h2 id="raw-configuration-title">KMonad configuration</h2>
        <p class="dialog-intro">
          This is the runnable configuration rendered by the manager for this
          keyboard. Device-specific input/output settings are manager-owned.
        </p>
        <p class="raw-configuration-meta">
          Revision {rawConfiguration.revision} · {rawConfiguration.format} ·
          {rawConfiguration.digest}
        </p>
        <pre class="raw-configuration-content"><code
            >{rawConfiguration.content}</code
          ></pre>
      </dialog>
    </div>
  {/if}
  {#if identifyOpen && selectedDevice}
    <div class="identify-dialog-backdrop">
      <dialog class="identify-dialog" open aria-labelledby="identify-title">
        <Button
          variant="icon"
          className="identify-close"
          on:click={closeIdentify}
          aria-label="Close keyboard identification"
          title="Close identification">×</Button
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
            <div class="identify-timing">
              <label for="identify-timeout">Session length</label>
              <select
                id="identify-timeout"
                bind:value={identifyTimeoutMS}
                disabled={!!(operation && !terminal(operation.state))}
              >
                <option value={5_000}>5 seconds</option>
                <option value={15_000}>15 seconds</option>
                <option value={30_000}>30 seconds</option>
              </select>
              {#if operation && !terminal(operation.state)}
                <strong aria-live="polite"
                  >{identifyRemainingSeconds}s remaining</strong
                >
              {/if}
            </div>
            <div class="identify-actions">
              <Button
                variant="primary"
                on:click={startIdentify}
                disabled={!canIdentify ||
                  identifyBusy ||
                  !!(operation && !terminal(operation.state))}
                >{identifyBusy
                  ? "Working…"
                  : operation && terminal(operation.state)
                    ? "Try again"
                    : `Start ${identifyTimeoutMS / 1000}-second identification`}</Button
              ><Button
                variant="text"
                on:click={cancelIdentify}
                disabled={!operation ||
                  terminal(operation.state) ||
                  identifyBusy}>Cancel</Button
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
