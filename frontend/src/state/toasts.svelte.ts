import { explain } from "../domain/text";

export type ToastTone = "success" | "info" | "error";
export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

/**
 * Results and errors that are not tied to one field. Results and notices
 * dismiss themselves; errors stay until dismissed. Repeating a message
 * refreshes it instead of stacking duplicates.
 */
export class ToastCenter {
  items = $state.raw<Toast[]>([]);
  readonly durationMS: number;
  readonly #maxItems = 4;
  #nextID = 1;
  readonly #timers = new Map<number, ReturnType<typeof setTimeout>>();

  constructor(durationMS = 6000) {
    this.durationMS = durationMS;
  }

  get results() {
    return this.items.filter((toast) => toast.tone !== "error");
  }

  get errors() {
    return this.items.filter((toast) => toast.tone === "error");
  }

  success(message: string) {
    this.#show(message, "success");
  }

  info(message: string) {
    this.#show(message, "info");
  }

  error(error: unknown) {
    this.#show(typeof error === "string" ? error : explain(error), "error");
  }

  dismiss(id: number) {
    clearTimeout(this.#timers.get(id));
    this.#timers.delete(id);
    this.items = this.items.filter((toast) => toast.id !== id);
  }

  dispose() {
    for (const timer of this.#timers.values()) clearTimeout(timer);
    this.#timers.clear();
  }

  #show(message: string, tone: ToastTone) {
    const existing = this.items.find(
      (toast) => toast.message === message && toast.tone === tone,
    );
    const id = existing?.id ?? this.#nextID++;
    if (!existing) {
      this.items = [
        ...this.items.slice(-(this.#maxItems - 1)),
        { id, message, tone },
      ];
    }
    clearTimeout(this.#timers.get(id));
    if (tone !== "error") {
      this.#timers.set(
        id,
        setTimeout(() => this.dismiss(id), this.durationMS),
      );
    }
  }
}
