import type {
  AppliedState,
  Profile,
  ProfileAssignment,
  ProfileBehavior,
} from "./desktop";

export type ChangeKind = "added" | "changed" | "removed";

export interface AssignmentChange {
  kind: ChangeKind;
  layerID: string;
  sourceKey: string;
  before?: ProfileBehavior;
  after?: ProfileBehavior;
}
export interface LayerChange {
  kind: ChangeKind;
  id: string;
  name: string;
  beforeName?: string;
}
export interface DeclarationChange {
  kind: ChangeKind;
  name: string;
  type: "alias" | "macro";
}
export interface ApplyDiff {
  assignments: AssignmentChange[];
  layers: LayerChange[];
  declarations: DeclarationChange[];
  count: number;
}

// Go omits empty fields while the editor may send explicit nulls, and the two
// order keys differently, so values compare by a canonical encoding.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined && item !== null)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
const same = (left: unknown, right: unknown) =>
  canonical(left) === canonical(right);
const assignmentKey = (assignment: ProfileAssignment) =>
  `${assignment.layer_id}\u0000${assignment.source_key}`;

function diffRecords<T>(
  before: Record<string, T> | undefined,
  after: Record<string, T> | undefined,
  type: DeclarationChange["type"],
): DeclarationChange[] {
  const names = new Set([
    ...Object.keys(before ?? {}),
    ...Object.keys(after ?? {}),
  ]);
  return [...names].sort().flatMap((name): DeclarationChange[] => {
    const old = before?.[name];
    const next = after?.[name];
    if (old === undefined) return [{ kind: "added", name, type }];
    if (next === undefined) return [{ kind: "removed", name, type }];
    return same(old, next) ? [] : [{ kind: "changed", name, type }];
  });
}

/**
 * Compares a draft with the state its profile last applied. Without an applied
 * state (a first Apply) every explicit assignment, extra layer, alias and
 * macro is reported as added. Assignments keep the draft's order, followed by
 * removals in the applied order.
 */
export function diffAgainstApplied(
  applied: AppliedState | null | undefined,
  draft: Pick<Profile, "layers" | "assignments" | "aliases" | "macros">,
): ApplyDiff {
  const beforeAssignments = new Map(
    (applied?.assignments ?? []).map((item) => [assignmentKey(item), item]),
  );
  const afterAssignments = new Map(
    (draft.assignments ?? []).map((item) => [assignmentKey(item), item]),
  );
  const assignments: AssignmentChange[] = [];
  for (const [key, after] of afterAssignments) {
    const before = beforeAssignments.get(key);
    if (!before || !same(before.behavior, after.behavior)) {
      assignments.push({
        kind: before ? "changed" : "added",
        layerID: after.layer_id,
        sourceKey: after.source_key,
        before: before?.behavior,
        after: after.behavior,
      });
    }
  }
  for (const [key, before] of beforeAssignments) {
    if (!afterAssignments.has(key)) {
      assignments.push({
        kind: "removed",
        layerID: before.layer_id,
        sourceKey: before.source_key,
        before: before.behavior,
      });
    }
  }

  const beforeLayers = new Map(
    (applied?.layers ?? [{ id: "base", name: "Base" }]).map((layer) => [
      layer.id,
      layer,
    ]),
  );
  const afterLayers = new Map(draft.layers.map((layer) => [layer.id, layer]));
  const layers: LayerChange[] = [];
  for (const layer of draft.layers) {
    const before = beforeLayers.get(layer.id);
    if (!before) layers.push({ kind: "added", id: layer.id, name: layer.name });
    else if (before.name !== layer.name) {
      layers.push({
        kind: "changed",
        id: layer.id,
        name: layer.name,
        beforeName: before.name,
      });
    }
  }
  for (const layer of beforeLayers.values()) {
    if (!afterLayers.has(layer.id)) {
      layers.push({ kind: "removed", id: layer.id, name: layer.name });
    }
  }

  const declarations = [
    ...diffRecords(applied?.aliases, draft.aliases, "alias"),
    ...diffRecords(applied?.macros, draft.macros, "macro"),
  ];
  return {
    assignments,
    layers,
    declarations,
    count: assignments.length + layers.length + declarations.length,
  };
}
