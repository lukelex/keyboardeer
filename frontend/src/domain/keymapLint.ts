import type { ProfileBehavior } from "../platform/desktop";
import { baseLayerID, type Keymap } from "./keymap";

export interface KeymapSuggestion {
  id: string;
  /** The layer the suggestion is about, to show it. */
  layerID: string;
  /** The key to show, when the suggestion is about one key. */
  sourceKey?: string;
  message: string;
}

const shortTimeoutMS = 120;
const longTimeoutMS = 500;

/** Every behavior reachable from this one, through tap-hold, aliases and macros. */
function* expand(
  keymap: Keymap,
  behavior: ProfileBehavior | undefined,
  seen = new Set<string>(),
): Generator<ProfileBehavior> {
  if (!behavior) return;
  yield behavior;
  if (behavior.kind === "tap_hold") {
    yield* expand(keymap, behavior.tap, seen);
    yield* expand(keymap, behavior.hold, seen);
  } else if (behavior.kind === "alias" && behavior.target) {
    if (seen.has(`a:${behavior.target}`)) return;
    seen.add(`a:${behavior.target}`);
    yield* expand(keymap, keymap.profile.aliases?.[behavior.target], seen);
  } else if (behavior.kind === "macro" && behavior.target) {
    if (seen.has(`m:${behavior.target}`)) return;
    seen.add(`m:${behavior.target}`);
    for (const step of keymap.profile.macros?.[behavior.target] ?? []) {
      yield* expand(keymap, step, seen);
    }
  }
}

function switchTargets(keymap: Keymap, behavior: ProfileBehavior | undefined) {
  return [...expand(keymap, behavior)]
    .filter((item) => item.kind === "switch_layer" && item.target)
    .map((item) => item.target!);
}

/** The behavior a key has while `layerID` is active, after falling through. */
function effective(keymap: Keymap, layerID: string, sourceKey: string) {
  return keymap.fallsThrough(layerID, sourceKey)
    ? keymap.behaviorAt(baseLayerID, sourceKey)
    : keymap.behaviorAt(layerID, sourceKey);
}

/**
 * Design checks the manager cannot make: it validates the configuration,
 * not whether the layout does what was meant.
 */
export function lintKeymap(keymap: Keymap): KeymapSuggestion[] {
  const suggestions: KeymapSuggestion[] = [];
  const sourceKeys = keymap.profile.geometry.source_keys;
  const keyName = (sourceKey: string) => keymap.catalog.name(sourceKey);

  for (const layer of keymap.layers) {
    if (layer.id === baseLayerID) continue;
    const switchedTo = keymap.assignments.some((assignment) =>
      switchTargets(keymap, assignment.behavior).includes(layer.id),
    );
    const leaves = sourceKeys.some((sourceKey) =>
      switchTargets(keymap, effective(keymap, layer.id, sourceKey)).some(
        (target) => target !== layer.id,
      ),
    );
    if (switchedTo && !leaves) {
      suggestions.push({
        id: `no-way-back:${layer.id}`,
        layerID: layer.id,
        message: `${layer.name} can be switched to, but nothing on it switches back. Give a key on ${layer.name} a Switch layer action to Base.`,
      });
    }
    if (keymap.assignmentCount(layer.id) === 0) {
      suggestions.push({
        id: `empty:${layer.id}`,
        layerID: layer.id,
        message: `${layer.name} has no assignments yet, so every key falls through to Base.`,
      });
    }
    // A layer entered only by holding one key: that key is always down
    // while the layer is active, so its own assignment there is unusable.
    const entries = keymap.assignments.filter((assignment) =>
      keymap.targetsLayer(assignment.behavior, layer.id),
    );
    const holdsOnly = entries.every((assignment) =>
      [...expand(keymap, assignment.behavior)].some(
        (item) => item.kind === "hold_layer" && item.target === layer.id,
      ),
    );
    if (entries.length && holdsOnly) {
      for (const entry of entries) {
        if (keymap.isRemapped(layer.id, entry.source_key)) {
          suggestions.push({
            id: `held-key:${layer.id}:${entry.source_key}`,
            layerID: layer.id,
            sourceKey: entry.source_key,
            message: `${keyName(entry.source_key)} holds ${layer.name}, so it is always pressed while ${layer.name} is active; its assignment there can never be used.`,
          });
        }
      }
    }
  }

  for (const assignment of keymap.assignments) {
    const behavior = assignment.behavior;
    if (behavior.kind !== "tap_hold") continue;
    const timeout = behavior.timeout_ms ?? 0;
    if (timeout && (timeout < shortTimeoutMS || timeout > longTimeoutMS)) {
      suggestions.push({
        id: `timeout:${assignment.layer_id}:${assignment.source_key}`,
        layerID: assignment.layer_id,
        sourceKey: assignment.source_key,
        message:
          timeout < shortTimeoutMS
            ? `${keyName(assignment.source_key)} switches to its hold action after only ${timeout} ms, so normal typing may trigger it. 150–250 ms is typical.`
            : `${keyName(assignment.source_key)} waits ${timeout} ms before its hold action, which can feel slow. 150–250 ms is typical.`,
      });
    }
  }

  const used = new Set(
    keymap.assignments.flatMap((assignment) =>
      [...expand(keymap, assignment.behavior)]
        .filter((item) => item.kind === "alias" || item.kind === "macro")
        .map((item) => `${item.kind}:${item.target}`),
    ),
  );
  for (const name of Object.keys(keymap.profile.aliases ?? {})) {
    if (!used.has(`alias:${name}`)) {
      suggestions.push({
        id: `unused-alias:${name}`,
        layerID: baseLayerID,
        message: `Alias @${name} is not used by any key.`,
      });
    }
  }
  for (const name of Object.keys(keymap.profile.macros ?? {})) {
    if (!used.has(`macro:${name}`)) {
      suggestions.push({
        id: `unused-macro:${name}`,
        layerID: baseLayerID,
        message: `Macro #${name} is not used by any key.`,
      });
    }
  }
  return suggestions;
}
