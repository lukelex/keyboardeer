// Static facts about KMonad output keys that are independent of any one
// physical layout.

export type NamedKey = { label: string; source_key: string };

export const navigationSystemKeys: readonly NamedKey[] = [
  { label: "Num Lock", source_key: "nlck" },
  { label: "Scroll Lock", source_key: "scrlck" },
  { label: "System Request", source_key: "ssrq" },
  { label: "Break", source_key: "break" },
];

export const mediaSystemKeys: readonly NamedKey[] = [
  { label: "Mute", source_key: "mute" },
  { label: "Volume up", source_key: "volu" },
  { label: "Volume down", source_key: "voldwn" },
  { label: "Play / pause", source_key: "pp" },
  { label: "Next track", source_key: "next" },
  { label: "Previous track", source_key: "prev" },
  { label: "Stop playback", source_key: "stopcd" },
  { label: "Brightness up", source_key: "brup" },
  { label: "Brightness down", source_key: "brdown" },
  { label: "Keyboard backlight toggle", source_key: "kbdillumtoggle" },
  { label: "Keyboard backlight up", source_key: "blup" },
  { label: "Keyboard backlight down", source_key: "bldn" },
  { label: "Eject media", source_key: "eject" },
];

export const functionKeys: readonly NamedKey[] = Array.from(
  { length: 24 },
  (_, index) => ({ label: `F${index + 1}`, source_key: `f${index + 1}` }),
);

// Readable names for keys whose geometry or palette label is ambiguous or
// terse. Everything else uses its label.
export const keyNames: Readonly<Record<string, string>> = {
  esc: "Esc",
  grv: "Grave `",
  bspc: "Backspace",
  tab: "Tab",
  caps: "Caps Lock",
  ret: "Enter",
  spc: "Space",
  lsft: "Left Shift",
  rsft: "Right Shift",
  lctl: "Left Ctrl",
  rctl: "Right Ctrl",
  lalt: "Left Alt",
  ralt: "Right Alt",
  lmet: "Left Super",
  rmet: "Right Super",
  cmp: "Menu",
  ins: "Insert",
  del: "Delete",
  home: "Home",
  end: "End",
  pgup: "Page Up",
  pgdn: "Page Down",
  left: "Left arrow",
  rght: "Right arrow",
  up: "Up arrow",
  down: "Down arrow",
  prnt: "Print Screen",
};

// Short cap labels; the full name is in each key's tooltip and accessible
// name.
export const capLabels: Readonly<Record<string, string>> = {
  bspc: "Bksp",
  fwd: "Fwd",
  lctl: "L Ctrl",
  rctl: "R Ctrl",
  lsft: "L Shift",
  rsft: "R Shift",
  lalt: "L Alt",
  ralt: "R Alt",
  lmet: "L Super",
  rmet: "R Super",
  caps: "Caps",
  ssrq: "SysRq",
  scrlck: "ScrLk",
  nlck: "NumLk",
};

/** Maps `KeyboardEvent.code` to the KMonad source key it produces. */
export const browserCodeToSourceKey: Readonly<Record<string, string>> = {
  Escape: "esc",
  Backquote: "grv",
  Minus: "-",
  Equal: "=",
  Backspace: "bspc",
  Tab: "tab",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  CapsLock: "caps",
  Semicolon: ";",
  Quote: "'",
  Enter: "ret",
  ShiftLeft: "lsft",
  ShiftRight: "rsft",
  Comma: ",",
  Period: ".",
  Slash: "/",
  ControlLeft: "lctl",
  ControlRight: "rctl",
  MetaLeft: "lmet",
  MetaRight: "rmet",
  AltLeft: "lalt",
  AltRight: "ralt",
  Space: "spc",
  ContextMenu: "cmp",
  PrintScreen: "prnt",
  Pause: "pause",
  Insert: "ins",
  Delete: "del",
  Home: "home",
  End: "end",
  PageUp: "pgup",
  PageDown: "pgdn",
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "rght",
  ...Object.fromEntries(
    Array.from({ length: 10 }, (_, digit) => [`Digit${digit}`, `${digit}`]),
  ),
  ...Object.fromEntries(
    Array.from({ length: 26 }, (_, index) => {
      const letter = String.fromCharCode(65 + index);
      return [`Key${letter}`, letter.toLowerCase()];
    }),
  ),
  ...Object.fromEntries(functionKeys.map((key) => [key.label, key.source_key])),
};
