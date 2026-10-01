import type { GeometryTemplate } from "../platform/desktop";
import {
  capLabels,
  functionKeys,
  keyNames,
  mediaSystemKeys,
  navigationSystemKeys,
  type NamedKey,
} from "./keys";

export type PaletteKey = NamedKey;
export type PaletteGroupID =
  | "common"
  | "letters"
  | "numbers"
  | "symbols"
  | "modifiers"
  | "function"
  | "navigation"
  | "media"
  | "other";
export type PaletteCategory = "all" | PaletteGroupID;
export interface PaletteGroup {
  id: PaletteGroupID;
  label: string;
  heading: string;
  /** Keys listed here come first, in this order; others follow by label. */
  order: readonly string[];
}
export interface KeyChoiceGroup {
  heading: string;
  keys: { source_key: string; name: string }[];
}

// Palette groups in display order: keyboard order for symbols, left/right
// pairs for modifiers.
export const paletteGroups: readonly PaletteGroup[] = [
  {
    id: "common",
    label: "Common",
    heading: "Common keys",
    order: ["esc", "tab", "ret", "spc", "bspc"],
  },
  { id: "letters", label: "Letters", heading: "Letters", order: [] },
  {
    id: "numbers",
    label: "Numbers",
    heading: "Numbers",
    order: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  },
  {
    id: "symbols",
    label: "Symbols",
    heading: "Symbols",
    order: ["grv", "-", "=", "[", "]", "\\", ";", "'", ",", ".", "/"],
  },
  {
    id: "modifiers",
    label: "Modifiers",
    heading: "Modifiers",
    order: [
      "lctl",
      "rctl",
      "lsft",
      "rsft",
      "lalt",
      "ralt",
      "lmet",
      "rmet",
      "caps",
      "cmp",
    ],
  },
  { id: "function", label: "Function", heading: "Function keys", order: [] },
  {
    id: "navigation",
    label: "Navigation",
    heading: "Navigation & system",
    order: [
      "left",
      "down",
      "up",
      "rght",
      "home",
      "end",
      "pgup",
      "pgdn",
      "ins",
      "del",
      "prnt",
      "scrlck",
      "pause",
      "break",
      "nlck",
      "ssrq",
    ],
  },
  {
    id: "media",
    label: "Media",
    heading: "Media & brightness",
    order: [
      "mute",
      "voldwn",
      "volu",
      "prev",
      "pp",
      "next",
      "stopcd",
      "eject",
      "brdown",
      "brup",
      "kbdillumtoggle",
      "bldn",
      "blup",
    ],
  },
  { id: "other", label: "Other", heading: "Other keys", order: [] },
];

export const paletteCategories: readonly {
  id: PaletteCategory;
  label: string;
}[] = [
  { id: "all", label: "All" },
  ...paletteGroups.map(({ id, label }) => ({ id, label })),
];

const groupIndexByID = new Map(
  paletteGroups.map((group, index) => [group.id, index]),
);
const isFunctionKey = (sourceKey: string) => /^f\d+$/.test(sourceKey);

/**
 * The output keys an editor can assign for one verified geometry: every
 * source key of the layout plus the system keys KMonad can emit. It never
 * guesses a larger layout or offers unverified aliases. Repeated source codes
 * (for example on a split board) appear once.
 */
export class KeyCatalog {
  readonly keys: readonly PaletteKey[];
  readonly #bySourceKey: ReadonlyMap<string, PaletteKey>;

  constructor(geometry?: GeometryTemplate) {
    this.#bySourceKey = new Map(
      [
        ...(geometry?.keys ?? []),
        ...functionKeys,
        ...navigationSystemKeys,
        ...mediaSystemKeys,
      ].map((key) => [
        key.source_key,
        { label: key.label, source_key: key.source_key },
      ]),
    );
    this.keys = [...this.#bySourceKey.values()].sort((left, right) =>
      KeyCatalog.compare(left, right),
    );
  }

  /** Index into `paletteGroups` of the group a key belongs to. */
  static groupIndex(key: PaletteKey): number {
    const listed = paletteGroups.findIndex(({ order }) =>
      order.includes(key.source_key),
    );
    if (listed >= 0) return listed;
    if (/^[a-z]$/.test(key.source_key)) return groupIndexByID.get("letters")!;
    if (isFunctionKey(key.source_key)) return groupIndexByID.get("function")!;
    return groupIndexByID.get("other")!;
  }

  static compare(left: PaletteKey, right: PaletteKey): number {
    const group = KeyCatalog.groupIndex(left);
    const groupDifference = group - KeyCatalog.groupIndex(right);
    if (groupDifference) return groupDifference;
    if (isFunctionKey(left.source_key) && isFunctionKey(right.source_key)) {
      return (
        Number(left.source_key.slice(1)) - Number(right.source_key.slice(1))
      );
    }
    const order = paletteGroups[group].order;
    const rank = (key: PaletteKey) => {
      const index = order.indexOf(key.source_key);
      return index < 0 ? order.length : index;
    };
    return (
      rank(left) - rank(right) ||
      left.label.localeCompare(right.label, undefined, {
        sensitivity: "base",
      }) ||
      left.source_key.localeCompare(right.source_key)
    );
  }

  get first(): string {
    return this.keys[0]?.source_key ?? "";
  }

  has(sourceKey: string | undefined): sourceKey is string {
    return !!sourceKey && this.#bySourceKey.has(sourceKey);
  }

  group(key: PaletteKey): PaletteGroup {
    return paletteGroups[KeyCatalog.groupIndex(key)];
  }

  /** The full, readable name used in sentences, tooltips and search. */
  name(sourceKey: string | undefined): string {
    if (!sourceKey) return "…";
    return (
      keyNames[sourceKey] ??
      this.#bySourceKey.get(sourceKey)?.label ??
      sourceKey
    );
  }

  /** The short label printed on a palette cap. */
  capLabel(key: PaletteKey): string {
    return capLabels[key.source_key] ?? key.label;
  }

  search(query: string): PaletteKey[] {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [...this.keys];
    return this.keys.filter((key) =>
      [
        key.label,
        key.source_key,
        this.capLabel(key),
        this.name(key.source_key),
      ].some((value) => value.toLowerCase().includes(normalized)),
    );
  }

  inCategory(keys: readonly PaletteKey[], category: PaletteCategory) {
    return category === "all"
      ? [...keys]
      : keys.filter((key) => this.group(key).id === category);
  }

  /** The catalog as named groups, for key pickers. */
  choiceGroups(): KeyChoiceGroup[] {
    return paletteGroups
      .map((group, index) => ({
        heading: group.heading,
        keys: this.keys
          .filter((key) => KeyCatalog.groupIndex(key) === index)
          .map((key) => ({
            source_key: key.source_key,
            name: this.name(key.source_key),
          })),
      }))
      .filter((group) => group.keys.length);
  }
}
