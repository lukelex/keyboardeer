// This development fallback is replaced by Wails-generated bindings in desktop builds.
export interface AppInfo {
  name: string;
  version: string;
}
export interface ManagerStatus {
  state: string;
  message: string;
  endpoint: string;
  server_id?: string;
  manager_version?: string;
  capability?: string;
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
export interface DeviceListResult {
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
          IntegrationDeviceList?: () => Promise<DeviceListResult>;
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

function binding<T>(
  name: keyof NonNullable<
    NonNullable<NonNullable<Window["go"]>["main"]>["App"]
  >,
): T {
  const app = window.go?.main?.App;
  const call = app?.[name];
  if (!call) throw new Error(`Wails binding ${name} is unavailable.`);
  return call as T;
}
export const Info = () => binding<() => Promise<AppInfo>>("Info")();
export const ManagerStatus = () =>
  binding<() => Promise<ManagerStatus>>("ManagerStatus")();
export const IntegrationDeviceList = () =>
  binding<() => Promise<DeviceListResult>>("IntegrationDeviceList")();
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
