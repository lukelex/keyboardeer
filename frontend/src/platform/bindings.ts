// Feature detection for the Wails bridge. The browser preview and older
// desktop builds lack some bindings; the UI explains rather than fails.

export type BindingName = keyof NonNullable<
  NonNullable<NonNullable<Window["go"]>["main"]>["App"]
>;

export function hasDesktopBinding(name: BindingName) {
  return !!window.go?.main?.App?.[name];
}

/** Bindings are injected shortly after load; wait briefly for one. */
export async function waitForDesktopBinding(
  name: BindingName,
  timeoutMS = 1500,
) {
  const deadline = Date.now() + timeoutMS;
  while (!hasDesktopBinding(name) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return hasDesktopBinding(name);
}

export function onDesktopEvent(
  name: string,
  callback: (payload: unknown) => void,
): () => void {
  return window.runtime?.EventsOn?.(name, callback) ?? (() => {});
}

/** Opens a link in the person's browser (the webview cannot navigate away). */
export function openExternal(url: string) {
  if (window.runtime?.BrowserOpenURL) window.runtime.BrowserOpenURL(url);
  else window.open(url, "_blank", "noopener");
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (window.runtime?.ClipboardSetText) {
      return await window.runtime.ClipboardSetText(text);
    }
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
