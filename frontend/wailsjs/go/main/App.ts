// This development fallback is replaced by Wails-generated bindings in desktop builds.
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
  configured_by: string[];
  runtime_conflict: boolean;
  reason_code: string;
  reason: string;
}
export interface ManagerWorkspace {
  status: ManagerStatus;
  devices: Device[];
}
export interface Operation {
  id: string;
  kind: string;
  state: string;
  reason_code: string;
  reason: string;
}
export interface PreviewResult {
  validation: { outcome: string; reason_code: string; reason: string };
}

declare global {
  interface Window {
    go?: {
      main?: {
        App?: {
          Info?: () => Promise<AppInfo>;
          ManagerStatus?: () => Promise<ManagerStatus>;
          Workspace?: () => Promise<ManagerWorkspace>;
          IdentifyStart?: (
            deviceID: string,
            timeoutMS: number,
          ) => Promise<Operation>;
          IdentifyCancel?: (operationID: string) => Promise<Operation>;
          IdentifyOperation?: (operationID: string) => Promise<Operation>;
          IntegrationDeviceList?: () => Promise<{ devices: Device[] }>;
          IntegrationIdentifyStart?: (
            deviceID: string,
            timeoutMS: number,
          ) => Promise<Operation>;
          IntegrationIdentifyCancel?: (
            operationID: string,
          ) => Promise<Operation>;
          IntegrationOperationGet?: (operationID: string) => Promise<Operation>;
          IntegrationPreview?: (
            deviceID: string,
            behavior: string,
          ) => Promise<PreviewResult>;
        };
      };
    };
  }
}

type AppBindings = NonNullable<
  NonNullable<NonNullable<Window["go"]>["main"]>["App"]
>;
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
