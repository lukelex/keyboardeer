import { isConfigurable, isConnected } from "../domain/devices";
import { isTerminal } from "../domain/operations";
import {
  IdentifyCancel,
  IdentifyOperation,
  IdentifyStart,
  type Device,
  type ManagerWorkspace,
  type Operation,
} from "../platform/desktop";
import type { ManagerConnection } from "./connection.svelte";
import type { ToastCenter } from "./toasts.svelte";

/**
 * A manager-owned identification session: the person presses a key on the
 * selected keyboard to confirm which physical keyboard it is. Only that
 * keyboard's mapping pauses, and the manager restores it afterwards.
 */
export class IdentifySession {
  open = $state(false);
  device = $state.raw<Device | null>(null);
  operation = $state.raw<Operation | null>(null);
  busy = $state(false);
  timeoutMS = $state(15_000);
  remainingSeconds = $state(0);
  notice = $state("");
  readonly #connection: ManagerConnection;
  readonly #toasts: ToastCenter;
  #deadline = 0;
  #pollTimer: ReturnType<typeof setInterval> | undefined;
  #countdownTimer: ReturnType<typeof setInterval> | undefined;

  found = $derived(this.operation?.state === "succeeded");
  running = $derived(!!this.operation && !isTerminal(this.operation.state));
  finished = $derived(!!this.operation && isTerminal(this.operation.state));

  constructor(connection: ManagerConnection, toasts: ToastCenter) {
    this.#connection = connection;
    this.#toasts = toasts;
  }

  show(device: Device) {
    if (
      !this.#connection.canIdentify ||
      !isConfigurable(device) ||
      !isConnected(device)
    )
      return;
    this.device = device;
    this.operation = null;
    this.notice = "";
    this.open = true;
  }

  close() {
    if (this.running) void this.cancel();
    this.#stopTimers();
    this.open = false;
  }

  async start() {
    const device = this.device;
    if (!device || !this.#connection.canIdentify || this.busy) return;
    this.busy = true;
    try {
      this.operation = await IdentifyStart(device.id, this.timeoutMS);
      this.#stopTimers();
      this.#deadline = Date.now() + this.timeoutMS;
      this.#updateCountdown();
      this.#pollTimer = setInterval(() => void this.#poll(), 700);
      this.#countdownTimer = setInterval(() => this.#updateCountdown(), 250);
    } catch (error) {
      this.#toasts.error(error);
    } finally {
      this.busy = false;
    }
  }

  async cancel() {
    if (!this.operation || isTerminal(this.operation.state) || this.busy)
      return;
    this.busy = true;
    try {
      this.operation = await IdentifyCancel(this.operation.id);
      this.#stopTimers();
    } catch (error) {
      this.#toasts.error(error);
    } finally {
      this.busy = false;
    }
  }

  /** Keeps the selected keyboard current and explains if it goes away. */
  workspaceChanged(workspace: ManagerWorkspace) {
    if (!this.open || !this.device) return;
    const refreshed = workspace.snapshot?.devices?.find(
      (device) => device.id === this.device?.id,
    );
    if (!refreshed) {
      this.notice =
        "The selected keyboard is no longer reported by the manager. Identification may have ended.";
      return;
    }
    this.device = refreshed;
    if (refreshed.runtime_conflict) {
      this.notice =
        "The selected keyboard now has a runtime conflict. The manager may stop identification.";
    } else if (!isConnected(refreshed)) {
      this.notice =
        "The selected keyboard disconnected. The manager may stop identification.";
    }
  }

  dispose() {
    this.#stopTimers();
  }

  async #poll() {
    if (!this.operation) return;
    try {
      this.operation = await IdentifyOperation(this.operation.id);
      if (isTerminal(this.operation.state)) this.#stopTimers();
      else this.#updateCountdown();
    } catch (error) {
      this.#toasts.error(error);
      this.#stopTimers();
    }
  }

  #updateCountdown() {
    if (!this.#deadline) return;
    this.remainingSeconds = Math.max(
      0,
      Math.ceil((this.#deadline - Date.now()) / 1000),
    );
  }

  #stopTimers() {
    clearInterval(this.#pollTimer);
    clearInterval(this.#countdownTimer);
    this.#pollTimer = undefined;
    this.#countdownTimer = undefined;
    this.#deadline = 0;
    this.remainingSeconds = 0;
  }
}
