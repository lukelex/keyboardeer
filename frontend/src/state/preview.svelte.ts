import {
  PreviewProfile,
  type Profile,
  type ProfilePreview,
} from "../platform/desktop";

/** What the validator needs from the editor that owns it. */
export interface PreviewHost {
  /** The profile being edited right now. */
  readonly profile: Profile | null;
  /** Whether the manager currently offers candidate validation. */
  canValidate(): boolean;
  /** A preview for the current draft revision arrived. */
  previewAccepted(result: ProfilePreview): void;
  previewFailed(error: unknown): void;
}

/**
 * Asks the manager to validate the whole draft after edits settle. Only one
 * preview runs at a time and only the latest draft waits in line, which
 * protects the manager. Answers for an older draft or environment are ignored.
 */
export class PreviewValidator {
  preview = $state.raw<ProfilePreview | null>(null);
  busy = $state(false);
  readonly #host: PreviewHost;
  readonly #delayMS: number;
  #generation = 0;
  #inFlight = false;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #pending: { draft: Profile; generation: number } | null = null;

  constructor(host: PreviewHost, delayMS = 250) {
    this.#host = host;
    this.#delayMS = delayMS;
  }

  schedule(draft: Profile) {
    clearTimeout(this.#timer);
    this.#pending = null;
    const generation = ++this.#generation;
    this.busy = true;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.#queue(draft, generation);
    }, this.#delayMS);
  }

  /** Drops the current preview; optionally checks the current draft again. */
  invalidate(recheck: boolean) {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#pending = null;
    this.#generation += 1;
    this.busy = false;
    this.preview = null;
    const profile = this.#host.profile;
    if (recheck && profile) this.schedule(profile);
  }

  /** Marks a save in progress: the current preview no longer applies. */
  beginEdit() {
    this.invalidate(false);
    this.busy = true;
  }

  /** A save failed: nothing new to check. */
  abandonEdit() {
    this.busy = false;
  }

  dispose() {
    clearTimeout(this.#timer);
  }

  #queue(draft: Profile, generation: number) {
    if (this.#inFlight) {
      this.#pending = { draft, generation };
      return;
    }
    void this.#run(draft, generation);
  }

  #isCurrent(generation: number, profileID: string, revision: number) {
    const profile = this.#host.profile;
    return (
      generation === this.#generation &&
      profile?.id === profileID &&
      profile.draft_revision === revision
    );
  }

  async #run(draft: Profile, generation: number) {
    this.#inFlight = true;
    try {
      if (!this.#host.canValidate()) return;
      const result = await PreviewProfile(draft.id);
      if (
        this.#isCurrent(generation, result.profile_id, result.draft_revision)
      ) {
        this.preview = result;
        this.#host.previewAccepted(result);
      }
    } catch (error) {
      if (this.#isCurrent(generation, draft.id, draft.draft_revision)) {
        this.#host.previewFailed(error);
      }
    } finally {
      if (generation === this.#generation) this.busy = false;
      this.#inFlight = false;
      const next = this.#pending;
      this.#pending = null;
      if (next) this.#queue(next.draft, next.generation);
    }
  }
}
