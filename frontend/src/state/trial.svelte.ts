import { SetConfigurationEnabled } from "../platform/desktop";
import type { ManagerConnection } from "./connection.svelte";
import type { ToastCenter } from "./toasts.svelte";

/**
 * A safety timer after an Apply: unless the person keeps the new mapping
 * within the time limit, its bindings are switched off so the keyboard types
 * normally again. The manager has no trial apply, so this uses the ordinary
 * enable/disable lifecycle; it switches the mapping off rather than
 * restoring the previous one.
 */
export class ApplyTrial {
  configurationID = $state("");
  remainingSeconds = $state(0);
  readonly durationSeconds: number;
  readonly #connection: ManagerConnection;
  readonly #toasts: ToastCenter;
  #timer: ReturnType<typeof setInterval> | undefined;
  #deadline = 0;

  constructor(
    connection: ManagerConnection,
    toasts: ToastCenter,
    durationSeconds = 30,
  ) {
    this.#connection = connection;
    this.#toasts = toasts;
    this.durationSeconds = durationSeconds;
  }

  get active() {
    return this.configurationID !== "";
  }

  start(configurationID: string) {
    this.#stop();
    this.configurationID = configurationID;
    this.#deadline = Date.now() + this.durationSeconds * 1000;
    this.#tick();
    this.#timer = setInterval(() => this.#tick(), 250);
  }

  keep() {
    if (!this.active) return;
    this.#stop();
    this.#toasts.success("Kept the new mapping.");
  }

  /** Switches the trial mapping's bindings off now. */
  async turnOff() {
    const configurationID = this.configurationID;
    if (!configurationID) return;
    this.#stop();
    const configuration = this.#connection.configuration(configurationID);
    try {
      await SetConfigurationEnabled(configurationID, false);
      await this.#connection.refresh();
      this.#toasts.info(
        `Bindings for “${configuration?.name ?? "the new mapping"}” are off, so the keyboard types normally. Turn them back on from its keyboard card.`,
      );
    } catch (error) {
      this.#toasts.error(error);
    }
  }

  dispose() {
    clearInterval(this.#timer);
  }

  #tick() {
    this.remainingSeconds = Math.max(
      0,
      Math.ceil((this.#deadline - Date.now()) / 1000),
    );
    if (this.remainingSeconds === 0) void this.turnOff();
  }

  #stop() {
    clearInterval(this.#timer);
    this.#timer = undefined;
    this.configurationID = "";
    this.remainingSeconds = 0;
  }
}
