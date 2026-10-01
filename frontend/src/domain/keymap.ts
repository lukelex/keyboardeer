import type {
  Profile,
  ProfileAssignment,
  ProfileBehavior,
  ProfileLayer,
} from "../platform/desktop";
import type { KeyCatalog } from "./keyCatalog";
import { humanize } from "./text";

export const baseLayerID = "base";
export const defaultTapHoldTimeoutMS = 200;

export interface CapLegend {
  text: string;
  /** The hold action of a tap-hold key. */
  hold?: string;
}

export type EditableState = Pick<
  Profile,
  "layers" | "assignments" | "aliases" | "macros"
>;

/** A deep copy of the parts of a profile that editing changes. */
export function editableState(profile: EditableState): EditableState {
  return JSON.parse(
    JSON.stringify({
      layers: profile.layers,
      assignments: profile.assignments,
      aliases: profile.aliases,
      macros: profile.macros,
    }),
  ) as EditableState;
}

export function isValidDeclarationName(name: string) {
  return /^[A-Za-z][A-Za-z0-9-]*$/.test(name);
}

/**
 * Read-only queries and copy-on-write edits for one profile revision. A new
 * Keymap is created for every saved revision, so per-layer lookups are
 * cached safely.
 */
export class Keymap {
  readonly profile: Profile;
  readonly catalog: KeyCatalog;
  readonly #layerBehaviors = new Map<string, Record<string, ProfileBehavior>>();

  constructor(profile: Profile, catalog: KeyCatalog) {
    this.profile = profile;
    this.catalog = catalog;
  }

  get layers(): readonly ProfileLayer[] {
    return this.profile.layers;
  }

  get assignments(): readonly ProfileAssignment[] {
    return this.profile.assignments ?? [];
  }

  layer(id: string): ProfileLayer | undefined {
    return this.profile.layers.find((layer) => layer.id === id);
  }

  layerIndex(id: string): number {
    return this.profile.layers.findIndex((layer) => layer.id === id);
  }

  /** Also resolves layers that exist only in the last applied state. */
  layerName(id: string | undefined): string {
    return (
      this.layer(id ?? "")?.name ??
      this.profile.applied?.layers.find((layer) => layer.id === id)?.name ??
      id ??
      ""
    );
  }

  behaviorsOn(layerID: string): Readonly<Record<string, ProfileBehavior>> {
    let behaviors = this.#layerBehaviors.get(layerID);
    if (!behaviors) {
      behaviors = Object.fromEntries(
        this.assignments
          .filter((assignment) => assignment.layer_id === layerID)
          .map((assignment) => [assignment.source_key, assignment.behavior]),
      );
      this.#layerBehaviors.set(layerID, behaviors);
    }
    return behaviors;
  }

  behaviorAt(layerID: string, sourceKey: string): ProfileBehavior | undefined {
    return this.behaviorsOn(layerID)[sourceKey];
  }

  assignmentCount(layerID: string): number {
    return Object.keys(this.behaviorsOn(layerID)).length;
  }

  /** On an overlay layer, a key with nothing set uses the layer below. */
  fallsThrough(layerID: string, sourceKey: string): boolean {
    const behavior = this.behaviorAt(layerID, sourceKey);
    return (
      layerID !== baseLayerID && (!behavior || behavior.kind === "transparent")
    );
  }

  /**
   * The short legend on an editor keycap; falling-through keys show Base.
   * Tap-hold keys get a second line for the hold action.
   */
  capLegend(layerID: string, sourceKey: string): CapLegend {
    const shown = this.fallsThrough(layerID, sourceKey) ? baseLayerID : layerID;
    const behavior = this.behaviorAt(shown, sourceKey);
    if (behavior?.kind === "tap_hold") {
      return {
        text: this.label(behavior.tap, sourceKey, shown),
        hold:
          behavior.hold?.kind === "hold_layer"
            ? this.layerName(behavior.hold.target)
            : this.label(behavior.hold, sourceKey, shown),
      };
    }
    return { text: this.label(behavior, sourceKey, shown) };
  }

  /** Whether the layer explicitly changes what the key does. */
  isRemapped(layerID: string, sourceKey: string): boolean {
    const behavior = this.behaviorAt(layerID, sourceKey);
    return !!behavior && behavior.kind !== "transparent";
  }

  label(
    behavior: ProfileBehavior | undefined,
    sourceKey: string,
    layerID: string,
  ): string {
    if (!behavior) return layerID === baseLayerID ? sourceKey : "Pass through";
    switch (behavior.kind) {
      case "key":
        return behavior.key ?? sourceKey;
      case "transparent":
        return "Pass through";
      case "disabled":
        return "No output";
      case "tap_hold":
        return `Tap ${behavior.tap?.key ?? "…"} / hold ${
          behavior.hold?.kind === "hold_layer"
            ? this.layerName(behavior.hold.target)
            : (behavior.hold?.key ?? "…")
        }`;
      case "hold_layer":
        return `Hold ${this.layerName(behavior.target)}`;
      case "switch_layer":
        return `Switch ${this.layerName(behavior.target)}`;
      case "alias":
        return `@${behavior.target}`;
      case "macro":
        return `Macro ${behavior.target}`;
      default:
        return humanize(behavior.kind);
    }
  }

  /** A complete, untruncated sentence for the inspector and tooltips. */
  describe(
    behavior: ProfileBehavior | undefined,
    sourceKey: string,
    layerID: string,
  ): string {
    const name = (key: string | undefined) => this.catalog.name(key);
    if (!behavior) {
      return layerID === baseLayerID
        ? `Sends ${name(sourceKey)} (unchanged)`
        : "Passes through to the layer below";
    }
    switch (behavior.kind) {
      case "key":
        return `Sends ${name(behavior.key)}`;
      case "disabled":
        return "Sends nothing (disabled)";
      case "transparent":
        return "Passes through to the layer below";
      case "hold_layer":
        return `Holds the ${this.layerName(behavior.target)} layer while pressed`;
      case "switch_layer":
        return `Switches to the ${this.layerName(behavior.target)} layer`;
      case "tap_hold":
        return `Tap: ${
          behavior.tap ? this.#describePart(behavior.tap) : "…"
        } · Hold: ${
          behavior.hold ? this.#describePart(behavior.hold) : "…"
        } · ${behavior.timeout_ms ?? defaultTapHoldTimeoutMS} ms`;
      case "alias": {
        const target = behavior.target
          ? this.profile.aliases?.[behavior.target]
          : undefined;
        return `Alias @${behavior.target}${
          target ? ` → ${this.describe(target, sourceKey, layerID)}` : ""
        }`;
      }
      case "macro": {
        const steps = behavior.target
          ? (this.profile.macros?.[behavior.target] ?? [])
          : [];
        return `Macro #${behavior.target}${
          steps.length
            ? `: ${steps.map((step) => name(step.key)).join(", ")}`
            : ""
        }`;
      }
      default:
        return humanize(behavior.kind);
    }
  }

  #describePart(behavior: ProfileBehavior) {
    if (behavior.kind === "key") return this.catalog.name(behavior.key);
    if (behavior.kind === "hold_layer")
      return `${this.layerName(behavior.target)} layer`;
    return this.describe(behavior, "", baseLayerID);
  }

  /** Whether a behavior can activate a layer, through aliases and macros. */
  targetsLayer(
    behavior: ProfileBehavior,
    layerID: string,
    seen = new Set<string>(),
  ): boolean {
    if (
      (behavior.kind === "hold_layer" || behavior.kind === "switch_layer") &&
      behavior.target === layerID
    ) {
      return true;
    }
    if (behavior.kind === "tap_hold") {
      return Boolean(
        (behavior.tap && this.targetsLayer(behavior.tap, layerID, seen)) ||
        (behavior.hold && this.targetsLayer(behavior.hold, layerID, seen)),
      );
    }
    if (behavior.kind === "alias" && behavior.target) {
      if (seen.has(`a:${behavior.target}`)) return false;
      seen.add(`a:${behavior.target}`);
      const alias = this.profile.aliases?.[behavior.target];
      return alias ? this.targetsLayer(alias, layerID, seen) : false;
    }
    if (behavior.kind === "macro" && behavior.target) {
      if (seen.has(`m:${behavior.target}`)) return false;
      seen.add(`m:${behavior.target}`);
      return Boolean(
        this.profile.macros?.[behavior.target]?.some((step) =>
          this.targetsLayer(step, layerID, seen),
        ),
      );
    }
    return false;
  }

  /** How many assignments can enter the layer. */
  entryCount(layerID: string): number {
    return this.assignments.filter((assignment) =>
      this.targetsLayer(assignment.behavior, layerID),
    ).length;
  }

  isReachable(layerID: string): boolean {
    return layerID === baseLayerID || this.entryCount(layerID) > 0;
  }

  /** Short labels such as "Space (hold)" for every way into a layer. */
  entryLabels(layerID: string): string[] {
    return this.assignments.flatMap((assignment) => {
      const behavior = assignment.behavior;
      const key = this.catalog.name(assignment.source_key);
      if (behavior.kind === "hold_layer" && behavior.target === layerID)
        return [`${key} (hold)`];
      if (behavior.kind === "switch_layer" && behavior.target === layerID)
        return [`${key} (switch)`];
      if (
        behavior.kind === "tap_hold" &&
        behavior.hold?.kind === "hold_layer" &&
        behavior.hold.target === layerID
      )
        return [`${key} (hold)`];
      return this.targetsLayer(behavior, layerID) ? [key] : [];
    });
  }

  /** "via Space (hold)", or "via Space (hold) +2". Empty when unreachable. */
  entrySummary(layerID: string): string {
    const labels = this.entryLabels(layerID);
    if (!labels.length) return "";
    return `via ${labels[0]}${labels.length > 1 ? ` +${labels.length - 1}` : ""}`;
  }

  hasDeclaration(name: string): boolean {
    return !!(this.profile.aliases?.[name] || this.profile.macros?.[name]);
  }

  // Copy-on-write edits. Each returns a new profile; nothing is saved here.

  withBehavior(
    layerID: string,
    sourceKey: string,
    behavior: ProfileBehavior,
    base: Profile = this.profile,
  ): Profile {
    return {
      ...base,
      assignments: [
        ...(base.assignments ?? []).filter(
          (assignment) =>
            assignment.layer_id !== layerID ||
            assignment.source_key !== sourceKey,
        ),
        { layer_id: layerID, source_key: sourceKey, behavior },
      ],
    };
  }

  withoutAssignment(layerID: string, sourceKey: string): Profile {
    return {
      ...this.profile,
      assignments: this.assignments.filter(
        (assignment) =>
          assignment.layer_id !== layerID ||
          assignment.source_key !== sourceKey,
      ),
    };
  }

  /** A stable, unique layer ID derived from its name. */
  newLayerID(name: string): string {
    const stem =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "layer";
    let id = `layer-${stem}`;
    for (let suffix = 2; this.layer(id); suffix += 1) {
      id = `layer-${stem}-${suffix}`;
    }
    return id;
  }

  withLayer(layer: ProfileLayer): Profile {
    return { ...this.profile, layers: [...this.profile.layers, layer] };
  }

  withLayerName(layerID: string, name: string): Profile {
    return {
      ...this.profile,
      layers: this.profile.layers.map((layer) =>
        layer.id === layerID ? { ...layer, name } : layer,
      ),
    };
  }

  withLayerMoved(layerID: string, direction: -1 | 1): Profile | null {
    const index = this.layerIndex(layerID);
    const destination = index + direction;
    // Base is fixed first in the layer order.
    if (index < 1 || destination < 1 || destination >= this.layers.length)
      return null;
    const layers = [...this.profile.layers];
    [layers[index], layers[destination]] = [layers[destination], layers[index]];
    return { ...this.profile, layers };
  }

  withoutLayer(layerID: string): Profile {
    return {
      ...this.profile,
      layers: this.profile.layers.filter((layer) => layer.id !== layerID),
    };
  }

  withAlias(name: string, behavior: ProfileBehavior): Profile {
    return {
      ...this.profile,
      aliases: { ...(this.profile.aliases ?? {}), [name]: behavior },
    };
  }

  withMacro(name: string, steps: ProfileBehavior[]): Profile {
    return {
      ...this.profile,
      macros: { ...(this.profile.macros ?? {}), [name]: steps },
    };
  }
}
