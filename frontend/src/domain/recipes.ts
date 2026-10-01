import type { Profile, ProfileBehavior } from "../platform/desktop";
import type { KeyCatalog } from "./keyCatalog";
import { baseLayerID, defaultTapHoldTimeoutMS, Keymap } from "./keymap";

/**
 * A ready-made starting point: ordinary assignments (and layers) added to a
 * draft in one undoable edit. Recipes never touch keys they do not name.
 */
export interface Recipe {
  id: string;
  name: string;
  summary: string;
  /** Physical keys the layout must have. */
  sourceKeys: readonly string[];
  /** Output keys the layout must be able to send. */
  outputKeys: readonly string[];
  apply(keymap: Keymap): Profile;
}

const key = (output: string): ProfileBehavior => ({ kind: "key", key: output });
const tapHold = (tap: string, hold: ProfileBehavior): ProfileBehavior => ({
  kind: "tap_hold",
  tap: key(tap),
  hold,
  timeout_ms: defaultTapHoldTimeoutMS,
});

/** Applies assignments on one layer, in order, on top of a keymap. */
function assign(
  keymap: Keymap,
  layerID: string,
  assignments: [string, ProfileBehavior][],
): Profile {
  return assignments.reduce(
    (profile, [sourceKey, behavior]) =>
      keymap.withBehavior(layerID, sourceKey, behavior, profile),
    keymap.profile,
  );
}

/** Finds a layer by name, or adds it; returns the keymap and layer ID. */
function ensureLayer(keymap: Keymap, name: string): [Keymap, string] {
  const existing = keymap.layers.find((layer) => layer.name === name);
  if (existing) return [keymap, existing.id];
  const id = keymap.newLayerID(name);
  return [new Keymap(keymap.withLayer({ id, name }), keymap.catalog), id];
}

const homeRow: [string, string][] = [
  ["a", "lmet"],
  ["s", "lalt"],
  ["d", "lsft"],
  ["f", "lctl"],
  ["j", "rctl"],
  ["k", "rsft"],
  ["l", "ralt"],
  [";", "rmet"],
];

const navigation: [string, string][] = [
  ["h", "left"],
  ["j", "down"],
  ["k", "up"],
  ["l", "rght"],
  ["y", "home"],
  ["o", "end"],
  ["u", "pgup"],
  ["i", "pgdn"],
];

export const recipes: readonly Recipe[] = [
  {
    id: "caps-esc-ctrl",
    name: "Caps Lock: Esc on tap, Ctrl on hold",
    summary:
      "A quick tap sends Escape; holding it acts as Left Ctrl. Popular with Vim and terminal users.",
    sourceKeys: ["caps"],
    outputKeys: ["esc", "lctl"],
    apply: (keymap) =>
      assign(keymap, baseLayerID, [["caps", tapHold("esc", key("lctl"))]]),
  },
  {
    id: "caps-esc",
    name: "Caps Lock sends Esc",
    summary: "Turns the rarely used Caps Lock into a second Escape key.",
    sourceKeys: ["caps"],
    outputKeys: ["esc"],
    apply: (keymap) => assign(keymap, baseLayerID, [["caps", key("esc")]]),
  },
  {
    id: "swap-ctrl-caps",
    name: "Swap Ctrl and Caps Lock",
    summary:
      "Left Ctrl moves to the easier-to-reach Caps Lock position, and back.",
    sourceKeys: ["caps", "lctl"],
    outputKeys: ["caps", "lctl"],
    apply: (keymap) =>
      assign(keymap, baseLayerID, [
        ["caps", key("lctl")],
        ["lctl", key("caps")],
      ]),
  },
  {
    id: "home-row-mods",
    name: "Home-row modifiers",
    summary:
      "A S D F and J K L ; type as usual on tap and act as Super, Alt, Shift and Ctrl while held.",
    sourceKeys: homeRow.map(([sourceKey]) => sourceKey),
    outputKeys: [
      ...homeRow.map(([sourceKey]) => sourceKey),
      ...homeRow.map(([, modifier]) => modifier),
    ],
    apply: (keymap) =>
      assign(
        keymap,
        baseLayerID,
        homeRow.map(([sourceKey, modifier]) => [
          sourceKey,
          tapHold(sourceKey, key(modifier)),
        ]),
      ),
  },
  {
    id: "navigation-layer",
    name: "Arrow keys on a Navigation layer",
    summary:
      "Hold Space for a Navigation layer: H J K L are arrows, Y and O are Home and End, U and I are Page Up and Down.",
    sourceKeys: ["spc", ...navigation.map(([sourceKey]) => sourceKey)],
    outputKeys: ["spc", ...navigation.map(([, output]) => output)],
    apply: (keymap) => {
      const [withLayer, layerID] = ensureLayer(keymap, "Navigation");
      const entered = new Keymap(
        assign(withLayer, baseLayerID, [
          ["spc", tapHold("spc", { kind: "hold_layer", target: layerID })],
        ]),
        keymap.catalog,
      );
      return assign(
        entered,
        layerID,
        navigation.map(([sourceKey, output]) => [sourceKey, key(output)]),
      );
    },
  },
  {
    id: "disable-caps",
    name: "Disable Caps Lock",
    summary:
      "Caps Lock sends nothing, so it can no longer be pressed by accident.",
    sourceKeys: ["caps"],
    outputKeys: [],
    apply: (keymap) =>
      assign(keymap, baseLayerID, [["caps", { kind: "disabled" }]]),
  },
];

/** Why a recipe cannot be used on this layout; empty when it can. */
export function recipeUnavailableReason(
  recipe: Recipe,
  profile: Profile,
  catalog: KeyCatalog,
): string {
  const missing = recipe.sourceKeys.filter(
    (sourceKey) => !profile.geometry.source_keys.includes(sourceKey),
  );
  if (missing.length) {
    return `This layout has no ${missing.map((sourceKey) => catalog.name(sourceKey)).join(", ")} key.`;
  }
  const unsendable = recipe.outputKeys.filter((output) => !catalog.has(output));
  return unsendable.length
    ? `This layout cannot send ${unsendable.map((output) => catalog.name(output)).join(", ")}.`
    : "";
}
