import type {
  Configuration,
  Device,
  ManagerStatus,
  ScanMatch,
} from "../platform/desktop";
import { count } from "./text";

export function isConnected(device: Device) {
  return device.availability === "connected";
}

// Device roles are manager-owned semantics. An absent role stays visible for
// compatibility with older managers; an explicit non-input role is never
// configured.
export function isConfigurable(device: Device) {
  return device.role === undefined || device.role === "input";
}

export function deviceState(device: Device) {
  return device.runtime_conflict
    ? "conflict"
    : device.availability || "unknown";
}

export function deviceStateSummary(device: Device) {
  switch (deviceState(device)) {
    case "connected":
      return "Ready to configure.";
    case "disconnected":
      return "Reconnect this keyboard to configure or identify it.";
    case "inaccessible":
      return "The manager cannot access this keyboard. Check its input-access permissions.";
    case "unsupported":
      return "The manager does not support this keyboard on the current backend.";
    case "conflict":
      return "Another configuration or mapping conflicts with this keyboard.";
    default:
      return "The manager reported an unfamiliar device state.";
  }
}

export function runtimeHealthLabel(configuration: Configuration) {
  if (!configuration.enabled) return "Disabled";
  if (configuration.runtime.healthy) return "Healthy";
  if (!configuration.runtime.connected) return "Waiting for keyboard";
  return "Needs attention";
}

export function runtimeHealthDetail(configuration: Configuration) {
  return (
    configuration.runtime.reason ||
    "The manager did not provide a runtime explanation for this configuration."
  );
}

export function managerGuidance(status: ManagerStatus) {
  if (status.state === "browser_preview") {
    return "Use the native window from scripts/desktop.sh to connect to the local manager.";
  }
  if (status.state === "reconnecting" || status.state === "unavailable") {
    return "Make sure kmonad-device-manager v1.2.0 or newer is running for this user, then wait for KeyboarDeer to reconnect.";
  }
  if (status.state === "incomplete") {
    return status.capability === "manager.get"
      ? "Upgrade the manager to a release with the v1 API and capability reporting."
      : "The manager is reachable but has not enabled this capability; check its backend and permissions.";
  }
  return "KeyboarDeer will keep the manager-owned runtime untouched until the required capability is available.";
}

/** How well a verified layout fits the keys a keyboard reported. */
export function scanMatchDescription(match: ScanMatch) {
  switch (match.kind) {
    case "exact":
      return "Exact match";
    case "superset":
      return `Close: your keyboard has ${count(match.extra, "key")} this layout doesn't include`;
    case "subset":
      return `Close: ${count(match.missing, "key")} in this layout weren't reported by your keyboard`;
    default:
      return `Doesn't fit: ${count(match.missing, "key")} not reported, ${count(match.extra, "key")} not in this layout`;
  }
}
