import type { Direction } from "../../domain/keyboardGrid";

/** What a key press in the editor should do. */
export type EditorCommand =
  | { kind: "undo" }
  | { kind: "redo" }
  | { kind: "help" }
  | { kind: "select"; sourceKey: string }
  | { kind: "move"; direction: Direction }
  | { kind: "deselect" }
  | { kind: "restore" }
  | { kind: "search"; text: string };

export interface ShortcutContext {
  /** The selected source key, if any. */
  selected: string;
  /** Maps KeyboardEvent.code to the source key it produces on this layout. */
  sourceKeyFor(code: string): string | undefined;
}

const arrows: Record<string, Direction> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};

function isTextField(target: EventTarget | null) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function isActivatable(target: EventTarget | null) {
  return target instanceof HTMLElement && !!target.closest("button, a[href]");
}

/**
 * Maps a key press to an editor command. With nothing selected, pressing a
 * physical key selects it; with a key selected, arrows move the selection,
 * typing searches the palette, Delete/Backspace restore and Escape
 * deselects. Text fields, Tab, and Space/Enter on a focused button keep
 * their normal meaning.
 */
export function resolveShortcut(
  event: KeyboardEvent,
  context: ShortcutContext,
): EditorCommand | null {
  if (isTextField(event.target) || event.altKey || event.key === "Tab")
    return null;
  if (event.ctrlKey || event.metaKey) {
    const key = event.key.toLowerCase();
    if (key === "z") return { kind: event.shiftKey ? "redo" : "undo" };
    if (key === "y") return { kind: "redo" };
    return null;
  }
  if (event.key === "?") return { kind: "help" };
  if (
    isActivatable(event.target) &&
    (event.key === " " || event.key === "Enter")
  )
    return null;
  if (!context.selected) {
    if (event.repeat) return null;
    const sourceKey = context.sourceKeyFor(event.code);
    return sourceKey ? { kind: "select", sourceKey } : null;
  }
  if (arrows[event.key]) return { kind: "move", direction: arrows[event.key] };
  if (event.key === "Escape") return { kind: "deselect" };
  if (event.key === "Delete" || event.key === "Backspace")
    return { kind: "restore" };
  if (event.key.length === 1 && event.key !== " ") {
    return { kind: "search", text: event.key };
  }
  return null;
}
