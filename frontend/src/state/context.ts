import { createContext } from "svelte";
import type { KeyboarDeer } from "./app.svelte";
import type { DialogStack } from "./dialogs.svelte";

/**
 * The application instance for the component tree. App.svelte provides it;
 * feature components read the services they need from it.
 */
export const [useApp, provideApp] = createContext<KeyboarDeer>();

/** The open-dialog stack, for the shared Dialog component. */
export const [useDialogStack, provideDialogStack] =
  createContext<DialogStack>();
