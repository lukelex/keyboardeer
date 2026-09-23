// This development fallback is replaced by Wails-generated bindings in desktop builds.
export interface AppInfo {
  name: string;
  version: string;
}

declare global {
  interface Window {
    go?: {
      main?: {
        App?: {
          Info?: () => Promise<AppInfo>;
        };
      };
    };
  }
}

export function Info(): Promise<AppInfo> {
  const call = window.go?.main?.App?.Info;
  return call
    ? call()
    : Promise.reject(new Error("Wails bindings are unavailable."));
}
