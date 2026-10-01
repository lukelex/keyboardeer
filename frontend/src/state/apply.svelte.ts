import { emptyOperation } from "../domain/operations";
import { hasDesktopBinding } from "../platform/bindings";
import {
  ApplyProfile,
  DiscardPendingApply,
  ResumeApply,
  type Configuration,
  type Operation,
  type Profile,
  type ProfileApplyResult,
} from "../platform/desktop";

/** What the apply workflow needs from the editor and application. */
export interface ApplyHost {
  /** The profile being edited right now. */
  readonly profile: Profile | null;
  /** All profiles, so accepted work can be resumed after a reconnect. */
  readonly profiles: readonly Profile[];
  readonly live: boolean;
  /** A current, valid preview exists and nothing blocks an Apply. */
  readonly canApply: boolean;
  profileUpdated(profile: Profile): void;
  refresh(): Promise<void>;
  error(error: unknown): void;
}

/**
 * Review, apply, and recover applies whose outcome is not yet known. A
 * request the manager accepted keeps being followed, and a request it never
 * confirmed is replayed only when the manager guarantees idempotency.
 */
export class ApplyController {
  busy = $state(false);
  reviewOpen = $state(false);
  reviewNotice = $state("");
  #operation = $state.raw<Operation | null>(null);
  #operationProfileID = $state("");
  readonly #host: ApplyHost;
  readonly #resuming = new Set<string>();
  readonly #followTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(host: ApplyHost) {
    this.#host = host;
  }

  /** The most relevant Apply outcome to show for a profile. */
  outcomeFor(
    profile: Profile | null,
    configuration: Configuration | undefined,
  ): Operation | null {
    return (
      (this.#operationProfileID === profile?.id ? this.#operation : null) ??
      profile?.last_apply_operation ??
      configuration?.last_operation ??
      null
    );
  }

  /** Forgets the outcome shown for the previously edited profile. */
  reset() {
    this.#operation = null;
  }

  openReview() {
    if (!this.#host.canApply || this.busy) return;
    this.reviewNotice = "";
    this.reviewOpen = true;
  }

  closeReview() {
    this.reviewOpen = false;
  }

  async confirm() {
    this.reviewOpen = false;
    await this.apply();
  }

  async apply() {
    const profile = this.#host.profile;
    if (!profile || !this.#host.canApply || this.busy) return;
    this.busy = true;
    try {
      const result = await ApplyProfile(profile.id);
      this.accept(result);
      await this.#host.refresh();
      if (result.stale) {
        // Another client changed this keyboard's configuration after the
        // review. Nothing was applied; show the refreshed state and ask again.
        this.reviewNotice =
          "This keyboard's mapping was changed on the manager since you reviewed it. KeyboarDeer refreshed the keyboard state and applied nothing. Review your draft and apply again.";
        this.reviewOpen = true;
      }
    } catch (error) {
      this.#host.error(error);
    } finally {
      this.busy = false;
    }
  }

  /**
   * Replays the stored request with its idempotency key: the manager returns
   * the original outcome instead of applying a second time.
   */
  async checkPending() {
    const profile = this.#host.profile;
    if (!profile?.apply_pending || this.busy) return;
    this.busy = true;
    try {
      this.accept(await ResumeApply(profile.id));
      await this.#host.refresh();
    } catch (error) {
      this.#host.error(error);
    } finally {
      this.busy = false;
    }
  }

  /** The person checked the keyboard and clears an unresolved request. */
  async discardPending() {
    const profile = this.#host.profile;
    if (!profile?.apply_pending || this.busy) return;
    try {
      const cleared = await DiscardPendingApply(profile.id);
      this.accept({ profile: cleared, operation: emptyOperation });
    } catch (error) {
      this.#host.error(error);
    }
  }

  accept(result: ProfileApplyResult) {
    this.#host.profileUpdated(result.profile);
    if (this.#host.profile?.id === result.profile.id) {
      this.#operationProfileID = result.profile.id;
      this.#operation =
        result.uncertain || result.stale || !result.operation.id
          ? null
          : result.operation;
    }
    if (result.profile.apply_pending?.operation_id) {
      this.#follow(result.profile.id, 1000);
    }
  }

  /** Recovers accepted work on startup and reconnect. */
  resumeAll() {
    if (!this.#host.live) return;
    for (const profile of this.#host.profiles) {
      if (
        profile.apply_pending?.operation_id ||
        profile.apply_pending?.idempotency_supported
      ) {
        void this.#resume(profile.id);
      }
    }
  }

  dispose() {
    for (const timer of this.#followTimers.values()) clearTimeout(timer);
    this.#followTimers.clear();
  }

  #follow(profileID: string, delayMS: number) {
    if (this.#followTimers.has(profileID)) return;
    this.#followTimers.set(
      profileID,
      setTimeout(() => {
        this.#followTimers.delete(profileID);
        void this.#resume(profileID);
      }, delayMS),
    );
  }

  async #resume(profileID: string) {
    if (this.#resuming.has(profileID) || !hasDesktopBinding("ResumeApply"))
      return;
    this.#resuming.add(profileID);
    try {
      const result = await ResumeApply(profileID);
      this.accept(result);
      if (!result.profile.apply_pending) await this.#host.refresh();
    } catch {
      // Keep the stored request; the next reconnect or manual check retries.
    } finally {
      this.#resuming.delete(profileID);
    }
  }
}
