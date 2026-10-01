// Initial values for the complex-action dialogs. Opening a dialog for the
// key's own kind of behavior edits it in place; otherwise a new action starts
// from what the key sends now.
import type { ProfileBehavior } from "../platform/desktop";
import type { KeyCatalog } from "./keyCatalog";
import { defaultTapHoldTimeoutMS, type Keymap } from "./keymap";

export interface ActionContext {
  keymap: Keymap;
  catalog: KeyCatalog;
  layerID: string;
  sourceKey: string;
}

function current({ keymap, layerID, sourceKey }: ActionContext) {
  return sourceKey ? keymap.behaviorAt(layerID, sourceKey) : undefined;
}

/** What the key outputs now, or the first assignable key. */
export function currentOutput(context: ActionContext): string {
  const behavior = current(context);
  const { catalog, sourceKey } = context;
  if (behavior?.kind === "key" && catalog.has(behavior.key))
    return behavior.key;
  return catalog.has(sourceKey) ? sourceKey : catalog.first;
}

export interface TapHoldDefaults {
  tapKey: string;
  holdMode: "key" | "layer";
  holdKey: string;
  holdLayerID: string;
  timeoutMS: number;
  editing: boolean;
}

/** New tap-holds follow the home-row-modifier shape: hold is Left Ctrl. */
export function tapHoldDefaults(context: ActionContext): TapHoldDefaults {
  const { catalog, layerID } = context;
  const output = currentOutput(context);
  const defaults: TapHoldDefaults = {
    tapKey: output,
    holdMode: "key",
    holdKey: catalog.has("lctl") && output !== "lctl" ? "lctl" : catalog.first,
    holdLayerID: layerID,
    timeoutMS: defaultTapHoldTimeoutMS,
    editing: false,
  };
  const behavior = current(context);
  if (behavior?.kind !== "tap_hold") return defaults;
  defaults.editing = true;
  if (behavior.tap?.kind === "key" && behavior.tap.key)
    defaults.tapKey = behavior.tap.key;
  if (behavior.hold?.kind === "hold_layer" && behavior.hold.target) {
    defaults.holdMode = "layer";
    defaults.holdLayerID = behavior.hold.target;
  } else if (behavior.hold?.kind === "key" && behavior.hold.key) {
    defaults.holdKey = behavior.hold.key;
  }
  defaults.timeoutMS = behavior.timeout_ms ?? defaultTapHoldTimeoutMS;
  return defaults;
}

export function tapHoldBehavior(values: TapHoldDefaults): ProfileBehavior {
  return {
    kind: "tap_hold",
    tap: { kind: "key", key: values.tapKey },
    hold:
      values.holdMode === "layer"
        ? { kind: "hold_layer", target: values.holdLayerID }
        : { kind: "key", key: values.holdKey },
    timeout_ms: values.timeoutMS,
  };
}

export interface LayerActionDefaults {
  action: "hold_layer" | "switch_layer";
  targetID: string;
  editing: boolean;
}

export function layerActionDefaults(
  context: ActionContext,
): LayerActionDefaults {
  const behavior = current(context);
  if (
    (behavior?.kind === "hold_layer" || behavior?.kind === "switch_layer") &&
    behavior.target
  ) {
    return { action: behavior.kind, targetID: behavior.target, editing: true };
  }
  return { action: "hold_layer", targetID: context.layerID, editing: false };
}

export interface DeclarationDefaults {
  /** The alias or macro being edited; empty for a new one. */
  editing: string;
  name: string;
}

export function aliasDefaults(
  context: ActionContext,
): DeclarationDefaults & { key: string } {
  const behavior = current(context);
  const output = currentOutput(context);
  if (behavior?.kind !== "alias" || !behavior.target) {
    return { editing: "", name: "", key: output };
  }
  const alias = context.keymap.profile.aliases?.[behavior.target];
  return {
    editing: behavior.target,
    name: behavior.target,
    key: alias?.kind === "key" && alias.key ? alias.key : output,
  };
}

export function macroDefaults(
  context: ActionContext,
): DeclarationDefaults & { steps: string[]; nextKey: string } {
  const behavior = current(context);
  const nextKey = currentOutput(context);
  if (behavior?.kind !== "macro" || !behavior.target) {
    return { editing: "", name: "", steps: [], nextKey };
  }
  return {
    editing: behavior.target,
    name: behavior.target,
    steps: (context.keymap.profile.macros?.[behavior.target] ?? [])
      .map((step) => step.key ?? "")
      .filter(Boolean),
    nextKey,
  };
}
