import type { Action } from "svelte/action";

const focusableSelector =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * Modal behaviour for an open <dialog>: it inerts the rest of the app shell
 * (except toasts, so an error can still be read and dismissed), moves focus
 * inside, keeps Tab within it, and returns focus to the opener on close.
 * The dialog's backdrop must be a direct child of `.app-shell`.
 */
export const modal: Action<HTMLDialogElement> = (node) => {
  const opener =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  const shell = node.closest<HTMLElement>(".app-shell");
  const background = shell
    ? Array.from(shell.children).filter(
        (element): element is HTMLElement =>
          element !== node.parentElement &&
          !element.classList.contains("toast-region"),
      )
    : [];
  const previousInert = background.map((element) => element.inert);
  for (const element of background) element.inert = true;
  node.tabIndex = -1;

  const focusableElements = () =>
    Array.from(node.querySelectorAll<HTMLElement>(focusableSelector)).filter(
      (element) =>
        element.getAttribute("aria-hidden") !== "true" &&
        element.getClientRects().length > 0,
    );
  const initialFocusFrame = requestAnimationFrame(() => {
    (
      node.querySelector<HTMLElement>("[autofocus]") ??
      focusableElements()[0] ??
      node
    ).focus({ preventScroll: true });
  });
  const keepFocusInside = (event: KeyboardEvent) => {
    if (event.key !== "Tab") return;
    const elements = focusableElements();
    if (elements.length === 0) {
      event.preventDefault();
      node.focus();
      return;
    }
    const first = elements[0];
    const last = elements[elements.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !node.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !node.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };
  node.addEventListener("keydown", keepFocusInside);

  return {
    destroy() {
      cancelAnimationFrame(initialFocusFrame);
      node.removeEventListener("keydown", keepFocusInside);
      background.forEach((element, index) => {
        element.inert = previousInert[index];
      });
      if (opener?.isConnected) {
        requestAnimationFrame(() => {
          if (opener.isConnected && !opener.closest("[inert]")) opener.focus();
        });
      }
    },
  };
};
