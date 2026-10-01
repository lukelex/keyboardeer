import { isConfigurable } from "../domain/devices";
import { waitForDesktopBinding } from "../platform/bindings";
import {
  Info,
  type AppInfo,
  type Device,
  type Profile,
} from "../platform/desktop";
import { ConfigurationActions } from "./configurations.svelte";
import { ConfirmationService } from "./confirmations.svelte";
import { ManagerConnection, type WorkspaceChange } from "./connection.svelte";
import { DialogStack } from "./dialogs.svelte";
import { DraftEditor } from "./editor.svelte";
import { IdentifySession } from "./identify.svelte";
import { ProfileLibrary } from "./library.svelte";
import {
  LocalSettings,
  Navigation,
  type UISnapshot,
} from "./navigation.svelte";
import { PreferencesStore } from "./preferences.svelte";
import { SetupForm } from "./setup.svelte";
import { SourceViewer } from "./sources.svelte";
import { ToastCenter } from "./toasts.svelte";

/**
 * The composition root. It owns one instance of every service, wires them
 * together, and implements the use cases that span several of them (opening
 * a keyboard, switching or deleting profiles, restoring the last screen).
 * Each service keeps its own responsibility; this class only coordinates.
 */
export class KeyboarDeer {
  readonly toasts = new ToastCenter();
  readonly confirmations = new ConfirmationService();
  readonly dialogs = new DialogStack();
  readonly settings = new LocalSettings();
  readonly navigation = new Navigation();
  readonly connection = new ManagerConnection();
  readonly library = new ProfileLibrary();
  readonly preferences = new PreferencesStore();
  readonly setup = new SetupForm(this.library);
  readonly identify = new IdentifySession(this.connection, this.toasts);
  readonly configurations = new ConfigurationActions(
    this.connection,
    this.confirmations,
    this.toasts,
  );
  readonly sources = new SourceViewer(this.connection, this.toasts);
  readonly editor = new DraftEditor({
    library: this.library,
    connection: this.connection,
    toasts: this.toasts,
    device: () => this.navigation.device,
  });

  info = $state<AppInfo>({ name: "KeyboarDeer", version: "starting…" });
  firstRunOpen = $state(false);
  profileManagerOpen = $state(false);
  shortcutsOpen = $state(false);
  /** Height of the editor palette, so toasts never cover keys. */
  paletteHeight = $state(0);
  editorOpen = $derived(
    this.navigation.view === "editor" && !!this.editor.profile,
  );
  readonly #restore: UISnapshot = this.settings.readUI();
  #restored = $state(false);

  /** Starts the app; the returned function stops it. */
  start(): () => void {
    this.firstRunOpen = !this.settings.firstRunComplete;
    void this.preferences.load();
    void this.#loadInfo();
    void this.library.loadPendingFile();
    const stopObserving = this.connection.observe({
      workspaceChanged: (change) => this.#workspaceChanged(change),
      desktopReady: () => void this.#loadProfiles(),
      workspaceFailed: (error) => {
        this.editor.preview.invalidate(false);
        this.toasts.error(error);
      },
    });
    const stopPersisting = $effect.root(() => {
      $effect(() => {
        if (this.#restored) this.settings.writeUI(this.#snapshot());
      });
    });
    // The device view never waits on optional local-profile bindings: a
    // damaged store may disable setup, but never the manager workspace.
    const disconnect = this.connection.connect();
    return () => {
      disconnect();
      stopObserving();
      stopPersisting();
      this.toasts.dispose();
      this.identify.dispose();
      this.editor.dispose();
    };
  }

  // Navigation

  /** Edits the keyboard's profile, or sets one up when it has none. */
  openDevice(device: Device) {
    if (!this.connection.canShowDevices || !isConfigurable(device)) return;
    const profile = this.library.preferredFor(device);
    if (!profile) {
      this.#enterSetup(device);
      return;
    }
    this.navigation.show("editor", device);
    this.editor.open(profile);
  }

  backToDevices() {
    this.editor.close();
    this.navigation.home();
  }

  startFirstRun() {
    const device = this.connection.inputDevices[0];
    if (!device) return;
    this.dismissFirstRun();
    this.openDevice(device);
  }

  dismissFirstRun() {
    this.firstRunOpen = false;
    this.settings.completeFirstRun();
  }

  // Profiles

  async createProfileFromSetup() {
    const { device, geometryID } = this.setup;
    const name = this.setup.name.trim();
    if (!device || !geometryID || !name || this.library.busy) return;
    try {
      const created = await this.library.run(() =>
        this.library.create(device.id, name, geometryID),
      );
      this.navigation.show("editor", device);
      this.editor.open(created);
    } catch (error) {
      this.toasts.error(error);
    }
  }

  newProfile() {
    const device = this.navigation.device;
    if (!device) return;
    this.profileManagerOpen = false;
    this.#enterSetup(device);
  }

  /** Drafts save on every edit, so switching never loses pending changes. */
  async switchProfile(target: Profile) {
    const device = this.navigation.device;
    if (!device || this.library.busy || target.id === this.editor.profile?.id)
      return;
    try {
      await this.library.select(device.id, target.id);
      this.editor.open(
        this.library.profiles.find((profile) => profile.id === target.id) ??
          target,
      );
    } catch (error) {
      this.toasts.error(error);
    }
  }

  async duplicateProfile() {
    const profile = this.editor.profile;
    if (!profile || !this.navigation.device || this.library.busy) return;
    try {
      const copy = await this.library.run(() =>
        this.library.duplicate(profile),
      );
      await this.switchProfile(copy);
    } catch (error) {
      this.toasts.error(error);
    }
  }

  async exportProfile() {
    const profile = this.editor.profile;
    if (!profile || this.library.busy) return;
    try {
      await this.library.run(() => this.library.export(profile));
      this.toasts.success(
        "Portable profile exported. It contains behavior and layout data, not a runnable .kbd file.",
      );
    } catch (error) {
      this.toasts.error(error);
    }
  }

  async importProfile() {
    const device = this.navigation.device;
    if (!device || this.library.busy) return;
    try {
      const imported = await this.library.run(() =>
        this.library.import(device.id),
      );
      await this.switchProfile(imported);
      this.toasts.success(
        `Imported “${imported.name}” as a new draft for this keyboard.`,
      );
    } catch (error) {
      this.toasts.error(error);
    }
  }

  async deleteProfile() {
    const profile = this.editor.profile;
    const device = this.navigation.device;
    if (!profile || !device || this.library.busy) return;
    const confirmed = await this.confirmations.ask({
      title: `Delete “${profile.name}”?`,
      message: profile.manager_configuration_id
        ? "The profile is removed from KeyboarDeer. The mapping already applied to this keyboard keeps running; to stop it, use Remove from keyboard on the keyboard card."
        : "This draft has not been applied. Deleting it cannot be undone.",
      confirmLabel: "Delete profile",
      danger: true,
    });
    if (
      !confirmed ||
      this.editor.profile?.id !== profile.id ||
      this.library.busy
    )
      return;
    try {
      await this.library.run(() => this.library.remove(profile));
      this.editor.history.forget(profile.id);
      const next = this.library.preferredFor(device);
      if (next) {
        this.editor.close();
        await this.switchProfile(next);
      } else {
        this.profileManagerOpen = false;
        this.backToDevices();
      }
    } catch (error) {
      this.toasts.error(error);
    }
  }

  async recoverProfileStore() {
    const confirmed = await this.confirmations.ask({
      title: "Back up the damaged draft file and start fresh?",
      message:
        "KeyboarDeer keeps the damaged file as a backup and starts an empty draft list. Running mappings are unaffected.",
      confirmLabel: "Back up and start fresh",
    });
    if (confirmed) await this.library.recoverStore();
  }

  // Internals

  #enterSetup(device: Device, geometryID = "") {
    this.editor.close();
    this.navigation.show("setup", device);
    this.setup.enter(device, geometryID);
  }

  #workspaceChanged(change: WorkspaceChange) {
    // Recover accepted work on startup and reconnect, not on every snapshot.
    if (change.reconnected) queueMicrotask(() => this.editor.apply.resumeAll());
    if (change.environmentChanged) this.editor.environmentChanged(change.live);
    this.identify.workspaceChanged(change.workspace);
  }

  async #loadProfiles() {
    if (!(await this.library.load())) return;
    this.#restoreUI();
    this.editor.apply.resumeAll();
  }

  async #loadInfo() {
    try {
      await waitForDesktopBinding("Info");
      this.info = await Info();
    } catch {
      this.info = { name: "KeyboarDeer", version: "browser development" };
    }
  }

  #snapshot(): UISnapshot {
    return {
      view: this.navigation.view,
      deviceID: this.navigation.device?.id,
      profileID: this.editor.profile?.id,
      geometryID: this.setup.geometryID,
      layerID: this.editor.layerID,
      sourceKey: this.editor.sourceKey,
    };
  }

  /** Reopens the screen that was showing when the app last closed. */
  #restoreUI() {
    if (this.#restored) return;
    this.#restored = true;
    const saved = this.#restore;
    const device = this.connection.devices.find(
      (item) => item.id === saved.deviceID && isConfigurable(item),
    );
    if (!device) return;
    this.navigation.device = device;
    if (saved.view === "setup") {
      this.#enterSetup(
        device,
        this.library.geometry(saved.geometryID) ? saved.geometryID : "",
      );
      return;
    }
    if (saved.view !== "editor") return;
    const profiles = this.library.forDevice(device.id);
    const profile =
      profiles.find((item) => item.id === saved.profileID) ??
      profiles.find((item) => item.id === this.library.selected[device.id]);
    if (!profile) return;
    this.library.remember(device.id, profile.id);
    this.navigation.show("editor", device);
    this.editor.open(profile, {
      layerID: saved.layerID,
      sourceKey: saved.sourceKey,
    });
  }
}
