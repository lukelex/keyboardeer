export interface ConfirmationRequest {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
}
type PendingConfirmation = Required<ConfirmationRequest> & {
  resolve: (confirmed: boolean) => void;
};

/**
 * The one confirmation dialog. Every irreversible or disruptive action asks
 * through `ask()` and waits for the answer; asking again answers "no" to the
 * earlier question.
 */
export class ConfirmationService {
  current = $state.raw<PendingConfirmation | null>(null);

  ask(request: ConfirmationRequest): Promise<boolean> {
    this.current?.resolve(false);
    return new Promise((resolve) => {
      this.current = {
        cancelLabel: "Cancel",
        danger: false,
        ...request,
        resolve,
      };
    });
  }

  settle(confirmed: boolean) {
    const pending = this.current;
    this.current = null;
    pending?.resolve(confirmed);
  }
}
