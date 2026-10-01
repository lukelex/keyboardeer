import type { Action } from "svelte/action";

/**
 * WAI-ARIA tabs keyboard support for a `role="tablist"` element: arrow keys
 * move focus to and activate the next or previous tab, wrapping at the ends.
 * Up/Down are accepted as equivalents of Left/Right.
 */
export const rovingTabs: Action<HTMLElement> = (node) => {
  const handleKeydown = (event: KeyboardEvent) => {
    const offset =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (!offset) return;
    const tabs = Array.from(
      node.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    );
    const current = tabs.indexOf(event.target as HTMLButtonElement);
    if (tabs.length < 2 || current < 0) return;
    event.preventDefault();
    const next = tabs[(current + offset + tabs.length) % tabs.length];
    next.focus();
    next.click();
  };
  node.addEventListener("keydown", handleKeydown);
  return { destroy: () => node.removeEventListener("keydown", handleKeydown) };
};
