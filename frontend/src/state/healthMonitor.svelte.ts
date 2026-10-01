import { hasDesktopBinding } from "../platform/bindings";
import { Notify, type Configuration } from "../platform/desktop";
import type { ConnectionObserver, WorkspaceChange } from "./connection.svelte";
import type { ToastCenter } from "./toasts.svelte";

/** A managed mapping that is enabled, connected and still not running. */
function isFailing(configuration: Configuration) {
  return (
    configuration.ownership === "managed" &&
    configuration.enabled &&
    configuration.runtime.connected &&
    !configuration.runtime.healthy
  );
}

/**
 * Watches managed mappings while KeyboarDeer is open and says when one stops
 * running or recovers: a toast in the window, and a desktop notification
 * when the window is not in focus. A keyboard being unplugged is expected
 * and is not reported.
 */
export class RuntimeHealthMonitor implements ConnectionObserver {
  /** Whether desktop notifications are sent; toasts are always shown. */
  desktopAlerts = $state(true);
  readonly #toasts: ToastCenter;
  readonly #deviceName: (deviceID: string) => string;
  #failing: Map<string, boolean> | null = null;

  constructor(toasts: ToastCenter, deviceName: (deviceID: string) => string) {
    this.#toasts = toasts;
    this.#deviceName = deviceName;
  }

  workspaceChanged(change: WorkspaceChange) {
    if (!change.live || change.workspace.stale) return;
    const configurations = change.workspace.snapshot?.configurations ?? [];
    const previous = this.#failing;
    this.#failing = new Map(
      configurations.map((item) => [item.id, isFailing(item)]),
    );
    // The first snapshot is the baseline; only transitions are reported.
    if (!previous) return;
    for (const configuration of configurations) {
      const was = previous.get(configuration.id);
      const now = isFailing(configuration);
      if (was === undefined || was === now) continue;
      this.#report(configuration, now);
    }
  }

  #report(configuration: Configuration, failing: boolean) {
    const name = configuration.name || "A mapping";
    const keyboard = this.#deviceName(configuration.device_id);
    const where = keyboard ? ` on ${keyboard}` : "";
    if (failing) {
      const detail =
        configuration.runtime.reason ||
        "The manager reported a runtime problem.";
      this.#toasts.error(`${name}${where} stopped running: ${detail}`);
      this.#notify(`${name} stopped running${where}`, detail);
    } else {
      this.#toasts.success(`${name}${where} is running again.`);
      this.#notify(`${name} is running again${where}`, "");
    }
  }

  #notify(summary: string, body: string) {
    if (!this.desktopAlerts || !hasDesktopBinding("Notify")) return;
    if (!document.hidden && document.hasFocus()) return;
    void Notify(summary, body).catch(() => {
      // Desktop notifications are best effort; the toast remains.
    });
  }
}
