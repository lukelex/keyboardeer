import { isConnected } from "../domain/devices";
import { explain } from "../domain/text";
import { hasDesktopBinding } from "../platform/bindings";
import {
  InputScan,
  MatchInputScan,
  type Device,
  type InputScan as InputScanResult,
  type ScanMatch,
} from "../platform/desktop";
import type { ProfileLibrary } from "./library.svelte";

/**
 * The new-profile form. The layout is never carried over from another
 * keyboard: an exact match from manager-attested key capabilities is
 * preselected, and otherwise the person chooses explicitly.
 */
export class SetupForm {
  device = $state.raw<Device | null>(null);
  name = $state("");
  geometryID = $state("");
  scan = $state.raw<InputScanResult | null>(null);
  matches = $state.raw<ScanMatch[]>([]);
  scanning = $state(false);
  notice = $state("");
  /** True once the person picks a layout; detection never overrides it. */
  #chosen = false;
  readonly #library: ProfileLibrary;

  geometry = $derived.by(() => this.#library.geometry(this.geometryID));
  /** Candidates that could fit, best first. */
  candidates = $derived(
    this.matches.filter((match) => match.kind !== "partial"),
  );
  detectedExactly = $derived(
    this.matches.some(
      (match) =>
        match.kind === "exact" && match.geometry_id === this.geometryID,
    ),
  );

  constructor(library: ProfileLibrary) {
    this.#library = library;
  }

  get canDetect() {
    return hasDesktopBinding("InputScan");
  }

  enter(device: Device, geometryID = "") {
    const geometries = this.#library.geometries;
    this.device = device;
    this.scan = null;
    this.matches = [];
    this.notice = "";
    this.#chosen = !!geometryID;
    this.geometryID =
      geometryID || (geometries.length === 1 ? geometries[0].id : "");
    this.name = this.#library.uniqueName(
      device.id,
      device.display_name
        ? `${device.display_name} profile`
        : "Keyboard profile",
    );
    if (isConnected(device) && this.canDetect) void this.detect();
  }

  chooseGeometry(id: string) {
    this.geometryID = id;
    this.#chosen = true;
  }

  chooseMatch(match: ScanMatch) {
    if (match.kind !== "partial") this.chooseGeometry(match.geometry_id);
  }

  async detect() {
    const device = this.device;
    if (!device || this.scanning) return;
    this.scanning = true;
    this.notice = "";
    this.scan = null;
    this.matches = [];
    try {
      const scan = await InputScan(device.id);
      if (scan.token_namespace !== "kmonad-v1") {
        throw new Error(
          `Unsupported input scan namespace: ${scan.token_namespace}`,
        );
      }
      this.scan = scan;
      this.matches = await MatchInputScan(scan.keys);
      const exact = this.matches.find((match) => match.kind === "exact");
      if (exact && !this.#chosen && this.device?.id === device.id) {
        this.geometryID = exact.geometry_id;
      } else if (!exact) {
        this.notice =
          "No verified layout matches this keyboard exactly. Choose the closest candidate below, or pick a layout from the list.";
      }
    } catch (error) {
      this.notice = explain(error);
    } finally {
      this.scanning = false;
    }
  }
}
