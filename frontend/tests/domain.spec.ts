import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
  aliasDefaults,
  macroDefaults,
  tapHoldBehavior,
  tapHoldDefaults,
} from "../src/domain/actionDefaults";
import { KeyCatalog } from "../src/domain/keyCatalog";
import { KeyboardGrid } from "../src/domain/keyboardGrid";
import { Keymap, editableState } from "../src/domain/keymap";
import type { GeometryTemplate, Profile } from "../src/platform/desktop";

// Pure domain classes, tested without a browser page.
const tkl = JSON.parse(
  readFileSync(new URL("./fixtures/us-ansi-tkl.json", import.meta.url), "utf8"),
) as GeometryTemplate;
const catalog = new KeyCatalog(tkl);

const profile: Profile = {
  id: "profile-1",
  name: "Fixture",
  device_id: "device-1",
  draft_revision: 1,
  geometry: { id: tkl.id, source_keys: tkl.keys.map((key) => key.source_key) },
  layers: [
    { id: "base", name: "Base" },
    { id: "layer-nav", name: "Navigation" },
    { id: "layer-sym", name: "Symbols" },
  ],
  assignments: [
    {
      layer_id: "base",
      source_key: "caps",
      behavior: {
        kind: "tap_hold",
        tap: { kind: "key", key: "esc" },
        hold: { kind: "hold_layer", target: "layer-nav" },
        timeout_ms: 180,
      },
    },
    {
      layer_id: "base",
      source_key: "a",
      behavior: { kind: "alias", target: "home" },
    },
    {
      layer_id: "layer-nav",
      source_key: "h",
      behavior: { kind: "key", key: "left" },
    },
    {
      layer_id: "layer-nav",
      source_key: "j",
      behavior: { kind: "transparent" },
    },
  ],
  aliases: { home: { kind: "macro", target: "to-sym" } },
  macros: { "to-sym": [{ kind: "switch_layer", target: "layer-sym" }] },
  settings: { version: 1 },
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
};
const keymap = new Keymap(profile, catalog);

test("KeyCatalog orders, names and searches assignable keys", () => {
  expect(catalog.keys.slice(0, 5).map((key) => key.source_key)).toEqual([
    "esc",
    "tab",
    "ret",
    "spc",
    "bspc",
  ]);
  expect(catalog.name("lctl")).toBe("Left Ctrl");
  expect(catalog.name("f13")).toBe("F13");
  expect(catalog.capLabel({ label: "Ctrl", source_key: "rctl" })).toBe(
    "R Ctrl",
  );
  expect(catalog.search("volume").map((key) => key.source_key)).toEqual([
    "voldwn",
    "volu",
  ]);
  expect(catalog.inCategory(catalog.keys, "function")).toHaveLength(24);
  expect(catalog.choiceGroups()[0].heading).toBe("Common keys");
});

test("Keymap describes behaviors and finds layer entries through declarations", () => {
  expect(
    keymap.describe(keymap.behaviorAt("base", "caps"), "caps", "base"),
  ).toBe("Tap: Esc · Hold: Navigation layer · 180 ms");
  expect(keymap.capLegend("base", "caps")).toEqual({
    text: "esc",
    hold: "Navigation",
  });
  // Overlay keys with nothing set, or explicitly transparent, show Base.
  expect(keymap.fallsThrough("layer-nav", "j")).toBe(true);
  expect(keymap.capLegend("layer-nav", "z")).toEqual({ text: "z" });
  expect(keymap.capLegend("layer-nav", "h")).toEqual({ text: "left" });
  expect(keymap.isRemapped("base", "caps")).toBe(true);
  expect(keymap.isRemapped("layer-nav", "j")).toBe(false);
  expect(keymap.isRemapped("base", "z")).toBe(false);
  // Symbols is reachable only through alias → macro → switch_layer.
  expect(keymap.isReachable("layer-sym")).toBe(true);
  expect(keymap.entrySummary("layer-nav")).toBe("via Caps Lock (hold)");
  expect(keymap.entrySummary("layer-sym")).toBe("via A");
  expect(keymap.newLayerID("Navigation")).toBe("layer-navigation");
  expect(keymap.newLayerID("Nav")).toBe("layer-nav-2");
});

test("Keymap edits copy on write", () => {
  const edited = keymap.withBehavior("base", "caps", { kind: "disabled" });
  expect(new Keymap(edited, catalog).behaviorAt("base", "caps")).toEqual({
    kind: "disabled",
  });
  expect(keymap.behaviorAt("base", "caps")?.kind).toBe("tap_hold");
  expect(keymap.withLayerMoved("base", 1)).toBeNull();
  expect(
    keymap.withLayerMoved("layer-nav", 1)?.layers.map((layer) => layer.id),
  ).toEqual(["base", "layer-sym", "layer-nav"]);
  const state = editableState(profile);
  state.layers[0].name = "Changed";
  expect(profile.layers[0].name).toBe("Base");
});

test("dialog defaults edit the key's behavior or start from its output", () => {
  const editCaps = tapHoldDefaults({
    keymap,
    catalog,
    layerID: "base",
    sourceKey: "caps",
  });
  expect(editCaps).toMatchObject({
    editing: true,
    tapKey: "esc",
    holdMode: "layer",
    holdLayerID: "layer-nav",
    timeoutMS: 180,
  });
  expect(tapHoldBehavior(editCaps)).toEqual(keymap.behaviorAt("base", "caps"));
  // A new tap-hold on a plain key is a home-row modifier.
  expect(
    tapHoldDefaults({ keymap, catalog, layerID: "base", sourceKey: "f" }),
  ).toMatchObject({
    editing: false,
    tapKey: "f",
    holdMode: "key",
    holdKey: "lctl",
  });
  expect(
    aliasDefaults({ keymap, catalog, layerID: "base", sourceKey: "a" }),
  ).toMatchObject({ editing: "home", name: "home" });
  expect(
    macroDefaults({ keymap, catalog, layerID: "layer-nav", sourceKey: "h" }),
  ).toEqual({ editing: "", name: "", steps: [], nextKey: "left" });
});

test("KeyboardGrid finds spatial neighbours on the physical layout", () => {
  const grid = new KeyboardGrid(tkl);
  expect(grid.neighbor("f", "right")).toBe("g");
  expect(grid.neighbor("f", "left")).toBe("d");
  expect(grid.neighbor("f", "up")).toBe("r");
  expect(grid.neighbor("f", "down")).toBe("v");
  // Wide keys and gaps resolve to the closest key by position.
  expect(grid.neighbor("spc", "up")).toBe("b");
  expect(grid.neighbor("esc", "left")).toBeUndefined();
  expect(grid.neighbor("unknown", "up")).toBeUndefined();
});
