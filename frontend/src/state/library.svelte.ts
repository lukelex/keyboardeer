import { explain } from "../domain/text";
import { hasDesktopBinding, waitForDesktopBinding } from "../platform/bindings";
import {
  ClearPendingKbdProfileFile,
  CreateProfile,
  DeleteProfile,
  DuplicateProfile,
  ExportProfile,
  Geometries,
  ImportProfile,
  ImportProfileFromPath,
  PendingKbdProfileFile,
  Profiles,
  ProfileStoreStatus,
  RecoverCorruptProfileStore,
  SaveProfile,
  SelectedProfiles,
  SelectProfile,
  type Device,
  type GeometryTemplate,
  type Profile,
  type ProfileStoreStatus as StoreStatus,
} from "../platform/desktop";

/**
 * The locally stored, editable profiles and the verified layouts they use.
 * Profiles are the source of truth; nothing here touches a keyboard.
 */
export class ProfileLibrary {
  profiles = $state.raw<Profile[]>([]);
  /** The profile shown for each keyboard, by device ID. */
  selected = $state.raw<Record<string, string>>({});
  geometries = $state.raw<GeometryTemplate[]>([]);
  storeProblem = $state.raw<StoreStatus | null>(null);
  recoveryMessage = $state("");
  /** A *.kbdprofile.json passed to a desktop launch as the default handler. */
  pendingFile = $state("");
  /** One profile mutation at a time, including draft saves. */
  busy = $state(false);

  /** Loads layouts and profiles; false when the store could not be read. */
  async load(): Promise<boolean> {
    try {
      this.geometries = await Geometries();
    } catch {
      // The browser preview deliberately has no desktop persistence.
    }
    try {
      this.profiles = await Profiles();
      this.selected = await this.#selectedFromStore();
      this.storeProblem = null;
      return true;
    } catch {
      // Explain a damaged or newer store instead of showing every keyboard
      // as "not set up".
      if (hasDesktopBinding("ProfileStoreStatus")) {
        const status = await ProfileStoreStatus().catch(() => null);
        this.storeProblem = status && status.state !== "ok" ? status : null;
      }
      return false;
    }
  }

  async loadPendingFile() {
    if (!(await waitForDesktopBinding("PendingKbdProfileFile"))) return;
    this.pendingFile = await PendingKbdProfileFile().catch(() => "");
  }

  async dismissPendingFile() {
    this.pendingFile = "";
    await ClearPendingKbdProfileFile().catch(() => {});
  }

  /** Runs one mutation while holding the busy flag. */
  async run<T>(task: () => Promise<T>): Promise<T> {
    this.busy = true;
    try {
      return await task();
    } finally {
      this.busy = false;
    }
  }

  geometry(id: string | undefined): GeometryTemplate | undefined {
    return this.geometries.find((geometry) => geometry.id === id);
  }

  forDevice(deviceID: string): Profile[] {
    return this.profiles
      .filter((profile) => profile.device_id === deviceID)
      .sort((left, right) => left.created_at.localeCompare(right.created_at));
  }

  hasProfileFor(deviceID: string) {
    return this.profiles.some((profile) => profile.device_id === deviceID);
  }

  /** The keyboard's selected profile, or its oldest one. */
  preferredFor(device: Device): Profile | undefined {
    return (
      this.profiles.find(
        (profile) =>
          profile.id === this.selected[device.id] &&
          profile.device_id === device.id,
      ) ?? this.forDevice(device.id)[0]
    );
  }

  geometryFor(device: Device): GeometryTemplate | undefined {
    return this.geometry(this.preferredFor(device)?.geometry.id);
  }

  uniqueName(deviceID: string, base: string): string {
    const names = new Set(
      this.forDevice(deviceID).map((profile) => profile.name),
    );
    if (!names.has(base)) return base;
    let suffix = 2;
    while (names.has(`${base} ${suffix}`)) suffix += 1;
    return `${base} ${suffix}`;
  }

  /** Adds a profile or replaces the stored copy with the same ID. */
  put(profile: Profile) {
    this.profiles = this.profiles.some((item) => item.id === profile.id)
      ? this.profiles.map((item) => (item.id === profile.id ? profile : item))
      : [...this.profiles, profile];
  }

  remember(deviceID: string, profileID: string) {
    this.selected = { ...this.selected, [deviceID]: profileID };
  }

  async select(deviceID: string, profileID: string) {
    await SelectProfile(deviceID, profileID);
    this.remember(deviceID, profileID);
  }

  async create(deviceID: string, name: string, geometryID: string) {
    const created = await CreateProfile(deviceID, name, geometryID);
    this.put(created);
    this.remember(deviceID, created.id);
    return created;
  }

  async save(profile: Profile): Promise<Profile> {
    const saved = await SaveProfile(profile);
    this.put(saved);
    return saved;
  }

  async duplicate(profile: Profile) {
    const copy = await DuplicateProfile(
      profile.id,
      this.uniqueName(profile.device_id, `${profile.name} copy`.slice(0, 80)),
    );
    this.put(copy);
    return copy;
  }

  async remove(profile: Profile) {
    await DeleteProfile(profile.id, profile.draft_revision);
    this.profiles = this.profiles.filter((item) => item.id !== profile.id);
    this.selected = await this.#selectedFromStore();
  }

  /** Imports the launch file when there is one, otherwise asks for a file. */
  async import(deviceID: string) {
    const imported = this.pendingFile
      ? await ImportProfileFromPath(this.pendingFile, deviceID)
      : await ImportProfile(deviceID);
    this.put(imported);
    this.remember(deviceID, imported.id);
    if (this.pendingFile) await this.dismissPendingFile();
    return imported;
  }

  async export(profile: Profile) {
    await ExportProfile(profile.id);
  }

  async recoverStore() {
    try {
      const backup = await RecoverCorruptProfileStore();
      this.recoveryMessage = `The damaged draft file was kept at ${backup}. KeyboarDeer started a new, empty draft list.`;
      await this.load();
    } catch (error) {
      this.recoveryMessage = explain(error);
    }
  }

  async #selectedFromStore() {
    return hasDesktopBinding("SelectedProfiles")
      ? await SelectedProfiles()
      : {};
  }
}
