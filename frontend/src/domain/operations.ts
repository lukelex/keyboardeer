import type { Operation } from "../platform/desktop";
import { humanize } from "./text";

const terminalStates = new Set([
  "succeeded",
  "rejected",
  "failed",
  "rolled_back",
  "cancelled",
]);

export function isTerminal(state: string) {
  return terminalStates.has(state);
}

export const emptyOperation: Operation = {
  id: "",
  kind: "",
  state: "",
  reason_code: "",
  reason: "",
};

export function applyOutcomeTitle(operation: Operation) {
  return (
    {
      succeeded: "Applied to the keyboard.",
      rejected: "Apply rejected.",
      rolled_back: "Apply rolled back.",
      failed: "Apply failed.",
      running: "Applying…",
      queued: "Applying…",
      cancelled: "Apply cancelled.",
      unknown: "Apply outcome unknown.",
    }[operation.state] ?? `Apply ${humanize(operation.state).toLowerCase()}.`
  );
}

export function applyOutcomeDetail(operation: Operation) {
  switch (operation.state) {
    case "succeeded":
      return "The manager confirmed the new mapping is running.";
    case "rejected":
      return "The manager rejected this apply. Nothing on the keyboard changed.";
    case "rolled_back":
      return "The new mapping could not start, so the manager restored the previous mapping.";
    case "failed":
      return operation.reason_code === "runtime_rollback_failed"
        ? "The new mapping could not start and the previous one could not be restored. Check the keyboard card for its current state."
        : "The apply failed. Check the keyboard card for the mapping's current state.";
    case "running":
    case "queued":
      return "The manager is applying this profile. It keeps going even if you close KeyboarDeer.";
    case "cancelled":
      return "The manager cancelled this apply; the previous mapping remains.";
    default:
      return "";
  }
}

export function identifyStatusText(operation: Operation | null) {
  if (!operation) return "Not started";
  return (
    {
      queued: "Starting…",
      running: "Waiting for a key press",
      waiting: "Waiting for a key press",
      succeeded: "Key press detected",
      cancelled: "Cancelled",
      failed: "Did not finish",
      rejected: "The manager could not start identification",
    }[operation.state] ?? humanize(operation.state)
  );
}
