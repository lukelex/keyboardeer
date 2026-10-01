import type { EditableState } from "../domain/keymap";

interface Timeline {
  past: EditableState[];
  future: EditableState[];
}

/**
 * Session-local undo and redo, kept per profile so switching keyboards never
 * applies one draft's history to another.
 */
export class DraftHistory {
  #timelines = $state.raw<Record<string, Timeline>>({});
  readonly limit: number;

  constructor(limit = 100) {
    this.limit = limit;
  }

  canUndo(profileID: string) {
    return !!this.#timelines[profileID]?.past.length;
  }

  canRedo(profileID: string) {
    return !!this.#timelines[profileID]?.future.length;
  }

  /** The state an undo would restore. */
  previous(profileID: string): EditableState | undefined {
    const past = this.#timelines[profileID]?.past;
    return past?.[past.length - 1];
  }

  /** The state a redo would restore. */
  next(profileID: string): EditableState | undefined {
    const future = this.#timelines[profileID]?.future;
    return future?.[future.length - 1];
  }

  /** A new edit: remember what it replaced and drop the redo branch. */
  record(profileID: string, before: EditableState) {
    const timeline = this.#timeline(profileID);
    this.#set(profileID, {
      past: [...timeline.past, before].slice(-this.limit),
      future: [],
    });
  }

  /** An undo completed; `current` is what it replaced. */
  undone(profileID: string, current: EditableState) {
    const timeline = this.#timeline(profileID);
    this.#set(profileID, {
      past: timeline.past.slice(0, -1),
      future: [...timeline.future, current].slice(-this.limit),
    });
  }

  /** A redo completed; `current` is what it replaced. */
  redone(profileID: string, current: EditableState) {
    const timeline = this.#timeline(profileID);
    this.#set(profileID, {
      past: [...timeline.past, current].slice(-this.limit),
      future: timeline.future.slice(0, -1),
    });
  }

  forget(profileID: string) {
    const { [profileID]: _forgotten, ...rest } = this.#timelines;
    this.#timelines = rest;
  }

  #timeline(profileID: string): Timeline {
    return this.#timelines[profileID] ?? { past: [], future: [] };
  }

  #set(profileID: string, timeline: Timeline) {
    this.#timelines = { ...this.#timelines, [profileID]: timeline };
  }
}
