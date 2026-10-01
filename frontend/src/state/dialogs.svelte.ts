import { untrack } from "svelte";

interface OpenDialog {
  close(): void;
}

/**
 * The dialogs currently open, in opening order. Escape closes only the top
 * one, so a confirmation above another dialog never closes both.
 */
export class DialogStack {
  #open = $state.raw<readonly OpenDialog[]>([]);

  get isEmpty() {
    return this.#open.length === 0;
  }

  /** Registers an open dialog; the returned function unregisters it. */
  push(close: () => void): () => void {
    const entry: OpenDialog = { close };
    untrack(() => {
      this.#open = [...this.#open, entry];
    });
    return () => {
      untrack(() => {
        this.#open = this.#open.filter((candidate) => candidate !== entry);
      });
    };
  }

  /** Closes the topmost dialog; returns false when none is open. */
  closeTop(): boolean {
    const top = this.#open[this.#open.length - 1];
    top?.close();
    return !!top;
  }
}
