import type { Device } from "../platform/desktop";

export type View = "devices" | "setup" | "editor";

/** Where the person is: which screen, and which keyboard it is about. */
export class Navigation {
  view = $state<View>("devices");
  device = $state.raw<Device | null>(null);

  show(view: View, device: Device | null = this.device) {
    this.device = device;
    this.view = view;
  }

  home() {
    this.view = "devices";
    this.device = null;
  }
}

/** The screen and selection restored after a restart. */
export interface UISnapshot {
  view?: View;
  deviceID?: string;
  profileID?: string;
  geometryID?: string;
  layerID?: string;
  sourceKey?: string;
}

/**
 * Browser-local persistence for small UI conveniences. Storage may be
 * missing or blocked; the app works the same without it.
 */
export class LocalSettings {
  readonly #uiStateKey = "keyboardeer-ui-state";
  readonly #firstRunKey = "keyboardeer-first-run-complete";

  readUI(): UISnapshot {
    try {
      const value: unknown = JSON.parse(
        localStorage.getItem(this.#uiStateKey) ?? "{}",
      );
      return typeof value === "object" && value !== null
        ? (value as UISnapshot)
        : {};
    } catch {
      return {};
    }
  }

  writeUI(snapshot: UISnapshot) {
    this.#write(this.#uiStateKey, JSON.stringify(snapshot));
  }

  get firstRunComplete() {
    try {
      return localStorage.getItem(this.#firstRunKey) === "1";
    } catch {
      return false;
    }
  }

  completeFirstRun() {
    this.#write(this.#firstRunKey, "1");
  }

  #write(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // The application remains usable when browser storage is unavailable.
    }
  }
}
