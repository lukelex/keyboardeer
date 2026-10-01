import { humanize } from "../domain/text";
import {
  AdoptConfiguration,
  DeleteConfiguration,
  SetConfigurationEnabled,
  type Configuration,
} from "../platform/desktop";
import type { ConfirmationService } from "./confirmations.svelte";
import type { ManagerConnection } from "./connection.svelte";
import type { ToastCenter } from "./toasts.svelte";

/**
 * Lifecycle actions on manager-supervised mappings: enable, disable and
 * remove managed ones, and adopt external ones. Disruptive actions are
 * confirmed first.
 */
export class ConfigurationActions {
  /** The managed configuration whose lifecycle is changing. */
  busyID = $state("");
  adoptingID = $state("");
  readonly #connection: ManagerConnection;
  readonly #confirmations: ConfirmationService;
  readonly #toasts: ToastCenter;

  constructor(
    connection: ManagerConnection,
    confirmations: ConfirmationService,
    toasts: ToastCenter,
  ) {
    this.#connection = connection;
    this.#confirmations = confirmations;
    this.#toasts = toasts;
  }

  get canManage() {
    return (
      this.#connection.live &&
      this.#connection.capability("managed_configurations").available
    );
  }

  async remove(configuration: Configuration) {
    if (configuration.ownership !== "managed" || this.busyID) return;
    const confirmed = await this.#confirmations.ask({
      title: `Remove “${configuration.name || "this mapping"}” from the keyboard?`,
      message:
        "This stops the mapping on this keyboard and removes it from the manager. Your KeyboarDeer profiles are kept and can be applied again.",
      confirmLabel: "Remove from keyboard",
      cancelLabel: "Keep mapping",
      danger: true,
    });
    if (!confirmed || this.busyID) return;
    await this.#run(configuration, async () => {
      const result = await DeleteConfiguration(configuration.id);
      await this.#connection.refresh();
      this.#toasts.success(
        `Removed “${configuration.name}” from the keyboard: ${result.reason}. Your profiles were kept.`,
      );
    });
  }

  /** Resolves to whether the change went ahead (a disable can be declined). */
  async setEnabled(
    configuration: Configuration,
    enabled: boolean,
  ): Promise<boolean> {
    if (configuration.ownership !== "managed" || this.busyID) return false;
    if (
      !enabled &&
      !(await this.#confirmations.ask({
        title: `Disable bindings for “${configuration.name || "this mapping"}”?`,
        message:
          "The manager stops this mapping, and the keyboard types normally until you enable it again. The configuration and your profiles are kept.",
        confirmLabel: "Disable bindings",
        cancelLabel: "Keep running",
      }))
    ) {
      return false;
    }
    await this.#run(configuration, async () => {
      const result = await SetConfigurationEnabled(configuration.id, enabled);
      await this.#connection.refresh();
      this.#toasts.success(
        `Manager ${enabled ? "enabled" : "disabled"} bindings: ${result.reason}`,
      );
    });
    return true;
  }

  async adopt(configuration: Configuration) {
    if (
      this.adoptingID ||
      !this.#connection.capability("external_configuration_adoption").available
    )
      return;
    const label = configuration.name || "this external configuration";
    const confirmed = await this.#confirmations.ask({
      title: `Adopt ${label} as a managed configuration?`,
      message:
        "The manager takes ownership only if it can represent this configuration without loss. Adopting does not import arbitrary KMonad syntax into the visual editor.",
      confirmLabel: "Adopt as managed",
    });
    if (!confirmed || this.adoptingID) return;
    this.adoptingID = configuration.id;
    try {
      const result = await AdoptConfiguration(
        configuration.id,
        configuration.name || "",
      );
      this.#toasts.info(
        `Adoption ${humanize(result.state)}: ${result.reason || "The manager is processing the request."}`,
      );
      await this.#connection.refresh();
    } catch (error) {
      this.#toasts.error(error);
    } finally {
      this.adoptingID = "";
    }
  }

  async #run(configuration: Configuration, task: () => Promise<void>) {
    this.busyID = configuration.id;
    try {
      await task();
    } catch (error) {
      this.#toasts.error(error);
    } finally {
      this.busyID = "";
    }
  }
}
