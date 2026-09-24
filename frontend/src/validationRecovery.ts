import type {
  AssignmentFallback,
  Profile,
  ProfileBehavior,
  ProfilePreview,
} from "./desktop";

export interface MappedAssignmentIssue {
  diagnosticID: string;
  layerID: string;
  sourceKey: string;
  explicit: boolean;
  expectedAssignment?: ProfileBehavior;
}

export interface AssignmentRecovery {
  available: boolean;
  reason: string;
  source?: "last_validated" | "before_edit";
  hadAssignment?: boolean;
  behavior?: ProfileBehavior;
}

type Position = { line: number; column: number };

function comparePosition(left: Position, right: Position) {
  return left.line - right.line || left.column - right.column;
}

function validRange(
  location: NonNullable<
    NonNullable<ProfilePreview["validation"]["diagnostics"]>[number]["location"]
  >,
) {
  const values = [
    location.start_line,
    location.start_column,
    location.end_line,
    location.end_column,
  ];
  return (
    values.every((value) => Number.isInteger(value) && value > 0) &&
    comparePosition(
      { line: location.start_line, column: location.start_column },
      { line: location.end_line, column: location.end_column },
    ) < 0
  );
}

/** Resolve a manager range only when it is fully contained in one exact emitted
 * assignment slot and is bound to the exact behavior text submitted for this
 * preview. Missing digests, unknown scopes, and ambiguous ranges stay unmapped.
 */
export function mapDiagnosticToAssignment(
  preview: ProfilePreview,
  diagnostic: NonNullable<ProfilePreview["validation"]["diagnostics"]>[number],
  profile: Profile,
): MappedAssignmentIssue | null {
  const location = diagnostic.location;
  if (
    preview.validation.outcome !== "rejected" ||
    diagnostic.severity !== "error" ||
    !preview.candidate_digest ||
    !/^sha256:[a-f0-9]{64}$/.test(preview.candidate_digest) ||
    preview.validation.candidate_digest !== preview.candidate_digest ||
    !location ||
    location.scope !== "submitted_behavior" ||
    !validRange(location)
  ) {
    return null;
  }

  const start = { line: location.start_line, column: location.start_column };
  const end = { line: location.end_line, column: location.end_column };
  const matches = preview.source_map.filter((entry) => {
    const spanStart = {
      line: entry.span.start_line,
      column: entry.span.start_column,
    };
    const spanEnd = {
      line: entry.span.end_line,
      column: entry.span.end_column,
    };
    return (
      comparePosition(spanStart, start) <= 0 &&
      comparePosition(end, spanEnd) <= 0
    );
  });
  if (matches.length !== 1) return null;

  const entry = matches[0];
  const assignment = profile.assignments?.find(
    (candidate) =>
      candidate.layer_id === entry.layer_id &&
      candidate.source_key === entry.source_key,
  );
  if (entry.explicit !== !!assignment) return null;
  return {
    diagnosticID: diagnostic.id,
    layerID: entry.layer_id,
    sourceKey: entry.source_key,
    explicit: entry.explicit,
    expectedAssignment: assignment?.behavior,
  };
}

function fallbackAssignment(
  profile: Profile,
  issue: MappedAssignmentIssue,
  managerServerID: string,
): AssignmentRecovery {
  const recovery = profile.validation_recovery;
  const checkpoint = recovery?.checkpoint;
  if (
    checkpoint &&
    checkpoint.draft_revision < profile.draft_revision &&
    checkpoint.manager_server_id === managerServerID &&
    checkpoint.geometry.id === profile.geometry.id &&
    JSON.stringify(checkpoint.geometry.source_keys) ===
      JSON.stringify(profile.geometry.source_keys) &&
    /^sha256:[a-f0-9]{64}$/.test(checkpoint.candidate_digest) &&
    checkpoint.layers.some((layer) => layer.id === issue.layerID)
  ) {
    const assignment = checkpoint.assignments?.find(
      (candidate) =>
        candidate.layer_id === issue.layerID &&
        candidate.source_key === issue.sourceKey,
    );
    return {
      available: true,
      reason: assignment
        ? "Restores the last validated assignment. Other edits are kept."
        : `Restores the last validated default on the ${issue.layerID} layer. Other edits are kept.`,
      source: "last_validated",
      hadAssignment: !!assignment,
      behavior: assignment?.behavior,
    };
  }

  const beforeEdit = recovery?.pre_edit?.find(
    (candidate) =>
      candidate.layer_id === issue.layerID &&
      candidate.source_key === issue.sourceKey &&
      candidate.geometry_id === profile.geometry.id,
  );
  if (!beforeEdit) {
    return {
      available: false,
      reason: "No saved assignment is available for a safe targeted revert.",
    };
  }
  return {
    available: true,
    reason: beforeEdit.had_assignment
      ? "Restores the assignment from before this edit. Other edits are kept."
      : `Restores the original default on the ${issue.layerID} layer. Other edits are kept.`,
    source: "before_edit",
    hadAssignment: beforeEdit.had_assignment,
    behavior: beforeEdit.had_assignment ? beforeEdit.behavior : undefined,
  };
}

function behaviorDependenciesExist(
  behavior: ProfileBehavior,
  profile: Profile,
  seen = new Set<string>(),
): boolean {
  if (behavior.kind === "hold_layer" || behavior.kind === "switch_layer") {
    return profile.layers.some((layer) => layer.id === behavior.target);
  }
  if (behavior.kind === "alias") {
    const target = behavior.target ?? "";
    if (seen.has(`alias:${target}`)) return false;
    const declaration = profile.aliases?.[target];
    if (!declaration) return false;
    const next = new Set(seen);
    next.add(`alias:${target}`);
    return behaviorDependenciesExist(declaration, profile, next);
  }
  if (behavior.kind === "macro") {
    const target = behavior.target ?? "";
    if (seen.has(`macro:${target}`)) return false;
    const declaration = profile.macros?.[target];
    if (!declaration) return false;
    const next = new Set(seen);
    next.add(`macro:${target}`);
    return declaration.every((step) =>
      behaviorDependenciesExist(step, profile, next),
    );
  }
  if (behavior.kind === "tap_hold") {
    return (
      !!behavior.tap &&
      !!behavior.hold &&
      behaviorDependenciesExist(behavior.tap, profile, seen) &&
      behaviorDependenciesExist(behavior.hold, profile, seen)
    );
  }
  return true;
}

export function assignmentRecovery(
  profile: Profile,
  issue: MappedAssignmentIssue,
  managerServerID: string,
): AssignmentRecovery {
  if (!issue.explicit) {
    return {
      available: false,
      reason: "This location is not an explicit profile assignment.",
    };
  }
  if (!profile.layers.some((layer) => layer.id === issue.layerID)) {
    return {
      available: false,
      reason: "The affected layer was removed; recovery will not recreate it.",
    };
  }
  const current = profile.assignments?.find(
    (candidate) =>
      candidate.layer_id === issue.layerID &&
      candidate.source_key === issue.sourceKey,
  );
  if (!current || !issue.expectedAssignment) {
    return {
      available: false,
      reason:
        "The affected assignment changed; preview the current draft again.",
    };
  }

  const fallback = fallbackAssignment(profile, issue, managerServerID);
  if (!fallback.available) return fallback;
  if (fallback.hadAssignment && !fallback.behavior) {
    return {
      available: false,
      reason:
        "The saved assignment is incomplete and cannot be restored safely.",
    };
  }
  if (
    fallback.hadAssignment &&
    !behaviorDependenciesExist(fallback.behavior!, profile)
  ) {
    return {
      available: false,
      reason:
        "The saved assignment depends on a removed layer, alias, or macro; recovery will not recreate it.",
    };
  }
  if (
    fallback.hadAssignment &&
    JSON.stringify(fallback.behavior) === JSON.stringify(current.behavior)
  ) {
    return {
      available: false,
      reason: "The saved assignment is already current.",
    };
  }
  if (!fallback.hadAssignment && !current) {
    return {
      available: false,
      reason: "The saved default is already current.",
    };
  }
  return fallback;
}

export function assignmentMatchesIssue(
  profile: Profile,
  issue: MappedAssignmentIssue,
) {
  const current = profile.assignments?.find(
    (candidate) =>
      candidate.layer_id === issue.layerID &&
      candidate.source_key === issue.sourceKey,
  );
  return (
    !!current === issue.explicit &&
    (!current ||
      JSON.stringify(current.behavior) ===
        JSON.stringify(issue.expectedAssignment))
  );
}

export function applyAssignmentRecovery(
  profile: Profile,
  issue: MappedAssignmentIssue,
  recovery: AssignmentRecovery,
): Profile {
  if (!recovery.available) return profile;
  const assignments = (profile.assignments ?? []).filter(
    (assignment) =>
      assignment.layer_id !== issue.layerID ||
      assignment.source_key !== issue.sourceKey,
  );
  if (recovery.hadAssignment && recovery.behavior) {
    assignments.push({
      layer_id: issue.layerID,
      source_key: issue.sourceKey,
      behavior: recovery.behavior,
    });
  }
  return { ...profile, assignments };
}

/** Capture the prior assignment only once until a whole-draft validation
 * succeeds and replaces it with a stronger validated checkpoint.
 */
export function withPreEditFallback(before: Profile, after: Profile): Profile {
  const previousRecovery = before.validation_recovery ?? {};
  const fallbacks: AssignmentFallback[] = [
    ...(previousRecovery.pre_edit ?? []),
  ];
  const known = new Set(
    fallbacks.map((item) => `${item.layer_id}\u0000${item.source_key}`),
  );
  const oldAssignments = new Map(
    (before.assignments ?? []).map((assignment) => [
      `${assignment.layer_id}\u0000${assignment.source_key}`,
      assignment,
    ]),
  );
  const newAssignments = new Map(
    (after.assignments ?? []).map((assignment) => [
      `${assignment.layer_id}\u0000${assignment.source_key}`,
      assignment,
    ]),
  );
  const addresses = new Set([
    ...oldAssignments.keys(),
    ...newAssignments.keys(),
  ]);
  for (const address of addresses) {
    const oldAssignment = oldAssignments.get(address);
    const newAssignment = newAssignments.get(address);
    if (
      JSON.stringify(oldAssignment?.behavior) ===
        JSON.stringify(newAssignment?.behavior) ||
      known.has(address)
    ) {
      continue;
    }
    const separator = address.indexOf("\u0000");
    fallbacks.push({
      geometry_id: before.geometry.id,
      layer_id: address.slice(0, separator),
      source_key: address.slice(separator + 1),
      had_assignment: !!oldAssignment,
      ...(oldAssignment ? { behavior: oldAssignment.behavior } : {}),
    });
    known.add(address);
  }
  return {
    ...after,
    validation_recovery: {
      ...previousRecovery,
      pre_edit: fallbacks,
    },
  };
}
