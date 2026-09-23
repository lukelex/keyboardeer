// Typed Wails bridge owned by KeyboarDeer. It intentionally does not import
// generated wailsjs output, so browser development remains usable and Wails
// regeneration never changes application source files.
export interface AppInfo {
  name: string;
  version: string;
}
export interface Capability {
  name: string;
  available: boolean;
  reason_code: string;
  reason: string;
}
export interface ManagerStatus {
  state: string;
  message: string;
  endpoint: string;
  server_id?: string;
  manager_version?: string;
  capability?: string;
  capabilities?: Capability[];
}
export interface Device {
  id: string;
  display_name: string;
  availability: string;
  identity_stability: string;
  configured_by: string[] | null;
  runtime_conflict: boolean;
  reason_code: string;
  reason: string;
}
export interface ManagerWorkspace {
  status: ManagerStatus;
  snapshot?: Snapshot;
}
export interface RuntimeState {
  phase: string;
  reason_code: string;
  reason: string;
  connected: boolean;
  healthy: boolean;
  retry_at?: string;
  failure_count: number;
}
export interface Configuration {
  id: string;
  name: string;
  ownership: string;
  enabled: boolean;
  device_id: string;
  desired_revision: number;
  active_revision: number;
  runtime: RuntimeState;
}
export interface Snapshot {
  state_revision: number;
  event_cursor: { server_id: string; event_id: number; state_revision: number };
  devices: Device[] | null;
  configurations: Configuration[] | null;
  operations: Operation[] | null;
  health: { healthy: boolean; reason_code: string; reason: string };
}
export interface Operation {
  id: string;
  kind: string;
  state: string;
  resource?: { kind: string; id: string } | null;
  reason_code: string;
  reason: string;
  configuration_revision?: number;
}
export interface PreviewResult {
  validation: { outcome: string; reason_code: string; reason: string };
}
export interface ProfileGeometry {
  id: string;
  source_keys: string[];
}
export interface GeometryTemplate {
  id: string;
  name: string;
  description: string;
  keys: Array<{
    id: string;
    label: string;
    source_key: string;
    row: number;
    width: number;
    gap_before?: number;
  }>;
}
export interface ProfileLayer {
  id: string;
  name: string;
}
export interface ProfileBehavior {
  kind: string;
  key?: string;
  target?: string;
  tap?: ProfileBehavior;
  hold?: ProfileBehavior;
  timeout_ms?: number;
}
export interface ProfileAssignment {
  layer_id: string;
  source_key: string;
  behavior: ProfileBehavior;
}
export interface Profile {
  id: string;
  name: string;
  device_id: string;
  manager_configuration_id?: string;
  apply_pending?: { manager_server_id: string; started_at: string } | null;
  draft_revision: number;
  geometry: ProfileGeometry;
  layers: ProfileLayer[];
  assignments: ProfileAssignment[] | null;
  aliases?: Record<string, ProfileBehavior>;
  macros?: Record<string, ProfileBehavior[]>;
  settings: { version: number };
  created_at: string;
  updated_at: string;
}
export interface CompileResult {
  behavior: string;
  source_map: Array<{
    layer_id: string;
    source_key: string;
    explicit: boolean;
    span: {
      start_line: number;
      start_column: number;
      end_line: number;
      end_column: number;
    };
  }>;
}
export interface ProfilePreview {
  profile_id: string;
  draft_revision: number;
  device_id: string;
  manager_server_id: string;
  state_revision: number;
  validation: {
    outcome: string;
    reason_code: string;
    reason: string;
    diagnostics: Array<{
      id: string;
      severity: string;
      reason_code: string;
      summary: string;
      remediation: string;
    }> | null;
  };
  source_map: CompileResult["source_map"];
}
export interface ProfileApplyResult {
  profile: Profile;
  operation: Operation;
}

type AppBindings = {
  Info?: () => Promise<AppInfo>;
  ManagerStatus?: () => Promise<ManagerStatus>;
  Workspace?: () => Promise<ManagerWorkspace>;
  Geometries?: () => Promise<GeometryTemplate[]>;
  Profiles?: () => Promise<Profile[]>;
  CreateProfile?: (
    deviceID: string,
    name: string,
    geometryID: string,
  ) => Promise<Profile>;
  SaveProfile?: (profile: Profile) => Promise<Profile>;
  DeleteProfile?: (id: string, expectedDraftRevision: number) => Promise<void>;
  CompileProfile?: (id: string) => Promise<CompileResult>;
  PreviewProfile?: (id: string) => Promise<ProfilePreview>;
  ApplyProfile?: (id: string) => Promise<ProfileApplyResult>;
  SetConfigurationEnabled?: (
    configurationID: string,
    enabled: boolean,
  ) => Promise<Operation>;
  RecoverCorruptProfileStore?: () => Promise<string>;
  IdentifyStart?: (deviceID: string, timeoutMS: number) => Promise<Operation>;
  IdentifyCancel?: (operationID: string) => Promise<Operation>;
  IdentifyOperation?: (operationID: string) => Promise<Operation>;
  IntegrationDeviceList?: () => Promise<{ devices: Device[] }>;
  IntegrationIdentifyStart?: (
    deviceID: string,
    timeoutMS: number,
  ) => Promise<Operation>;
  IntegrationIdentifyCancel?: (operationID: string) => Promise<Operation>;
  IntegrationOperationGet?: (operationID: string) => Promise<Operation>;
  IntegrationPreview?: (
    deviceID: string,
    behavior: string,
  ) => Promise<PreviewResult>;
};

declare global {
  interface Window {
    go?: { main?: { App?: AppBindings } };
    runtime?: {
      EventsOn?: (
        eventName: string,
        callback: (payload: unknown) => void,
      ) => () => void;
    };
  }
}

function binding<T>(name: keyof AppBindings): T {
  const call = window.go?.main?.App?.[name];
  if (!call) throw new Error(`Wails binding ${name} is unavailable.`);
  return call as T;
}

export const Info = () => binding<() => Promise<AppInfo>>("Info")();
export const ManagerStatus = () =>
  binding<() => Promise<ManagerStatus>>("ManagerStatus")();
export const Workspace = () =>
  binding<() => Promise<ManagerWorkspace>>("Workspace")();
export const Geometries = () =>
  binding<() => Promise<GeometryTemplate[]>>("Geometries")();
export const Profiles = () => binding<() => Promise<Profile[]>>("Profiles")();
export const CreateProfile = (
  deviceID: string,
  name: string,
  geometryID: string,
) =>
  binding<
    (deviceID: string, name: string, geometryID: string) => Promise<Profile>
  >("CreateProfile")(deviceID, name, geometryID);
export const SaveProfile = (profile: Profile) =>
  binding<(profile: Profile) => Promise<Profile>>("SaveProfile")(profile);
export const DeleteProfile = (id: string, expectedDraftRevision: number) =>
  binding<(id: string, expectedDraftRevision: number) => Promise<void>>(
    "DeleteProfile",
  )(id, expectedDraftRevision);
export const CompileProfile = (id: string) =>
  binding<(id: string) => Promise<CompileResult>>("CompileProfile")(id);
export const PreviewProfile = (id: string) =>
  binding<(id: string) => Promise<ProfilePreview>>("PreviewProfile")(id);
export const ApplyProfile = (id: string) =>
  binding<(id: string) => Promise<ProfileApplyResult>>("ApplyProfile")(id);
export const SetConfigurationEnabled = (
  configurationID: string,
  enabled: boolean,
) =>
  binding<(configurationID: string, enabled: boolean) => Promise<Operation>>(
    "SetConfigurationEnabled",
  )(configurationID, enabled);
export const RecoverCorruptProfileStore = () =>
  binding<() => Promise<string>>("RecoverCorruptProfileStore")();
export const IdentifyStart = (id: string, timeout: number) =>
  binding<(id: string, timeout: number) => Promise<Operation>>("IdentifyStart")(
    id,
    timeout,
  );
export const IdentifyCancel = (id: string) =>
  binding<(id: string) => Promise<Operation>>("IdentifyCancel")(id);
export const IdentifyOperation = (id: string) =>
  binding<(id: string) => Promise<Operation>>("IdentifyOperation")(id);
export const IntegrationDeviceList = () =>
  binding<() => Promise<{ devices: Device[] }>>("IntegrationDeviceList")();
export const IntegrationIdentifyStart = (id: string, timeout: number) =>
  binding<(id: string, timeout: number) => Promise<Operation>>(
    "IntegrationIdentifyStart",
  )(id, timeout);
export const IntegrationIdentifyCancel = (id: string) =>
  binding<(id: string) => Promise<Operation>>("IntegrationIdentifyCancel")(id);
export const IntegrationOperationGet = (id: string) =>
  binding<(id: string) => Promise<Operation>>("IntegrationOperationGet")(id);
export const IntegrationPreview = (id: string, behavior: string) =>
  binding<(id: string, behavior: string) => Promise<PreviewResult>>(
    "IntegrationPreview",
  )(id, behavior);
