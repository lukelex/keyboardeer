import type { ProfilePreview } from "../platform/desktop";
import { humanize } from "./text";

export type ValidationState =
  | "checking"
  | "valid"
  | "rejected"
  | "blocked"
  | "unchecked"
  | (string & {});
export type Diagnostic = NonNullable<
  ProfilePreview["validation"]["diagnostics"]
>[number];

/** The accessible name of the header validation indicator. */
export function validationLabel(state: ValidationState) {
  const labels: Record<string, string> = {
    checking: "Checking draft preview",
    valid: "Valid configuration",
    rejected: "Invalid configuration",
    blocked: "Validation blocked",
    unchecked: "Draft not validated",
  };
  return labels[state] ?? `Validation ${humanize(state)}`;
}

/** The visible text of the header validation indicator. */
export function validationText(state: ValidationState) {
  const texts: Record<string, string> = {
    checking: "Checking…",
    valid: "Valid configuration",
    rejected: "Invalid configuration",
    blocked: "Validation blocked",
    unchecked: "Not validated",
  };
  return texts[state] ?? humanize(state);
}

export function diagnosticResourceLabel(diagnostic: Diagnostic) {
  if (!diagnostic.resource) return "Keymap-wide issue";
  if (diagnostic.resource.kind === "device") return "Selected keyboard";
  if (diagnostic.resource.kind === "configuration") return "Configuration";
  // The manager does not promise physical-key locations. Preserve opaque,
  // future resource kinds without guessing a key from display text.
  return `${humanize(diagnostic.resource.kind)} issue`;
}
