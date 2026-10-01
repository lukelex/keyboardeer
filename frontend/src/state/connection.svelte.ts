import { isConfigurable } from "../domain/devices";
import { explain } from "../domain/text";
import { onDesktopEvent, waitForDesktopBinding } from "../platform/bindings";
import {
  Workspace,
  type Capability,
  type Configuration,
  type Device,
  type ManagerWorkspace,
} from "../platform/desktop";

export type CapabilityName =
  | "device_discovery"
  | "device_identification"
  | "candidate_validation"
  | "managed_configurations"
  | "configuration_export"
  | "external_configuration_adoption";

export interface WorkspaceChange {
  readonly workspace: ManagerWorkspace;
  readonly live: boolean;
  /** Live again after being offline, or a different manager instance. */
  readonly reconnected: boolean;
  /** Anything that makes an earlier draft preview no longer current. */
  readonly environmentChanged: boolean;
}

export interface ConnectionObserver {
  workspaceChanged?(change: WorkspaceChange): void;
  /** The desktop bindings answered; local profiles can be loaded. */
  desktopReady?(): void;
  workspaceFailed?(error: unknown): void;
}

const initialWorkspace: ManagerWorkspace = {
  status: {
    state: "checking",
    message: "Checking the local manager connection…",
    endpoint: "",
  },
  stale: false,
};

function isWorkspace(value: unknown): value is ManagerWorkspace {
  return typeof value === "object" && value !== null && "status" in value;
}

/** The manager's authoritative workspace snapshot and its capabilities. */
export class ManagerConnection {
  workspace = $state.raw<ManagerWorkspace>(initialWorkspace);
  loading = $state(false);
  readonly #observers = new Set<ConnectionObserver>();

  live = $derived(
    this.workspace.status.state === "ready" && !this.workspace.stale,
  );
  devices = $derived(this.workspace.snapshot?.devices ?? []);
  inputDevices = $derived(this.devices.filter(isConfigurable));
  configurations = $derived(this.workspace.snapshot?.configurations ?? []);
  externalConfigurations = $derived(
    this.configurations.filter(
      (configuration) => configuration.ownership === "external",
    ),
  );
  canShowDevices = $derived(
    this.capability("device_discovery").available &&
      !!this.workspace.snapshot &&
      (this.live || !!this.workspace.stale),
  );
  canIdentify = $derived(
    this.live && this.capability("device_identification").available,
  );

  get status() {
    return this.workspace.status;
  }

  capability(name: CapabilityName): Capability {
    return (
      this.workspace.status.capabilities?.find(
        (item) => item.name === name,
      ) ?? {
        name,
        available: false,
        reason_code: "capability_unknown",
        reason: "The manager has not reported this capability.",
      }
    );
  }

  device(id: string | undefined): Device | undefined {
    return this.devices.find((device) => device.id === id);
  }

  configuration(id: string | undefined): Configuration | undefined {
    return id
      ? this.configurations.find((configuration) => configuration.id === id)
      : undefined;
  }

  configurationsFor(device: Device): Configuration[] {
    return this.configurations.filter(
      (configuration) => configuration.device_id === device.id,
    );
  }

  hasManagedConfiguration(deviceID: string) {
    return this.configurations.some(
      (configuration) =>
        configuration.device_id === deviceID &&
        configuration.ownership === "managed",
    );
  }

  operationFor(configuration: Configuration) {
    return (
      configuration.last_operation ??
      this.workspace.snapshot?.operations?.find(
        (operation) =>
          operation.resource?.kind === "configuration" &&
          operation.resource.id === configuration.id,
      )
    );
  }

  observe(observer: ConnectionObserver): () => void {
    this.#observers.add(observer);
    return () => this.#observers.delete(observer);
  }

  /** Subscribes to manager events and loads the first snapshot. */
  connect(): () => void {
    const stop = onDesktopEvent("workspace:changed", (next) => {
      if (isWorkspace(next)) this.accept(next);
    });
    void this.refresh();
    return stop;
  }

  async refresh() {
    this.loading = true;
    const bindingReady = await waitForDesktopBinding("Workspace");
    try {
      this.accept(await Workspace());
      if (bindingReady) this.#notify((observer) => observer.desktopReady?.());
    } catch (error) {
      const previous = this.workspace;
      // Keep the last authoritative snapshot visibly stale.
      this.accept({
        status: {
          state: bindingReady ? "unavailable" : "browser_preview",
          message: bindingReady
            ? `The desktop app could not load the manager workspace: ${explain(error)}`
            : "This browser preview has no Wails desktop bindings, so it cannot contact the local manager. Use the native KeyboarDeer window launched by scripts/desktop.sh.",
          endpoint: "",
          capabilities: previous.status.capabilities,
        },
        snapshot: previous.snapshot,
        stale: !!previous.snapshot,
        snapshot_at: previous.snapshot_at,
      });
      this.#notify((observer) => observer.workspaceFailed?.(error));
    } finally {
      this.loading = false;
    }
  }

  accept(next: ManagerWorkspace) {
    const previous = this.workspace;
    const wasLive = this.live;
    const live = next.status.state === "ready" && !next.stale;
    const change: WorkspaceChange = {
      workspace: next,
      live,
      reconnected:
        live &&
        (!wasLive || previous.status.server_id !== next.status.server_id),
      environmentChanged:
        wasLive !== live ||
        previous.status.server_id !== next.status.server_id ||
        previous.snapshot?.state_revision !== next.snapshot?.state_revision ||
        JSON.stringify(previous.status.capabilities ?? []) !==
          JSON.stringify(next.status.capabilities ?? []),
    };
    this.workspace = { ...next, stale: next.stale ?? false };
    this.#notify((observer) => observer.workspaceChanged?.(change));
  }

  #notify(call: (observer: ConnectionObserver) => void) {
    for (const observer of this.#observers) call(observer);
  }
}
