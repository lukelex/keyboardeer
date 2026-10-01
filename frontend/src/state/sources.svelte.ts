import { hasDesktopBinding } from "../platform/bindings";
import {
  ConfigurationContent,
  ExportConfiguration,
  SaveConfigurationExport,
  type Configuration,
  type ConfigurationContent as ExternalContent,
  type ConfigurationExport,
} from "../platform/desktop";
import type { ManagerConnection } from "./connection.svelte";
import type { ToastCenter } from "./toasts.svelte";

/**
 * Read-only access to KMonad sources the manager shares: the runnable .kbd it
 * rendered for a profile, and the source of external configurations.
 * KeyboarDeer never reads manager-owned files directly.
 */
export class SourceViewer {
  rendered = $state.raw<ConfigurationExport | null>(null);
  renderedOpen = $state(false);
  renderedBusy = $state(false);
  external = $state.raw<Configuration | null>(null);
  externalContent = $state.raw<ExternalContent | null>(null);
  externalBusy = $state(false);
  readonly #connection: ManagerConnection;
  readonly #toasts: ToastCenter;

  constructor(connection: ManagerConnection, toasts: ToastCenter) {
    this.#connection = connection;
    this.#toasts = toasts;
  }

  /** Why the rendered .kbd is unavailable for a profile; empty if available. */
  renderedUnavailableReason(configurationID: string | undefined) {
    const capability = this.#connection.capability("configuration_export");
    if (!configurationID) return "Apply this profile first";
    if (!this.#connection.live) return "The manager is not connected";
    if (!capability.available) return capability.reason;
    return "";
  }

  async showRendered(configurationID: string) {
    if (this.renderedBusy) return;
    this.renderedBusy = true;
    try {
      this.rendered = await ExportConfiguration(configurationID);
      this.renderedOpen = true;
    } catch (error) {
      this.#toasts.error(error);
    } finally {
      this.renderedBusy = false;
    }
  }

  closeRendered() {
    this.renderedOpen = false;
  }

  async saveRendered(configurationID: string) {
    if (this.renderedBusy) return;
    this.renderedBusy = true;
    try {
      await SaveConfigurationExport(configurationID);
      this.#toasts.success("Manager-rendered .kbd configuration saved.");
    } catch (error) {
      this.#toasts.error(error);
    } finally {
      this.renderedBusy = false;
    }
  }

  async showExternal(configuration: Configuration) {
    this.external = configuration;
    this.externalContent = null;
    if (
      !configuration.content_revision ||
      !hasDesktopBinding("ConfigurationContent") ||
      this.externalBusy
    )
      return;
    this.externalBusy = true;
    try {
      this.externalContent = await ConfigurationContent(
        configuration.id,
        configuration.content_revision,
      );
    } catch (error) {
      this.#toasts.error(error);
    } finally {
      this.externalBusy = false;
    }
  }

  closeExternal() {
    this.external = null;
  }
}
