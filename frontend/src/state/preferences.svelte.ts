import { hasDesktopBinding } from "../platform/bindings";
import {
  ChooseProfileSyncFolder,
  Preferences,
  SavePreferences,
} from "../platform/desktop";

/** Where KeyboarDeer keeps editable profiles. */
export class PreferencesStore {
  open = $state(false);
  syncEnabled = $state(false);
  folder = $state("");
  notice = $state("");
  busy = $state(false);

  async load() {
    if (!hasDesktopBinding("Preferences")) return;
    try {
      const value = await Preferences();
      this.syncEnabled = value.profile_sync_enabled;
      this.folder = value.profile_sync_folder;
    } catch {
      this.notice = "Preferences could not be loaded.";
    }
  }

  show() {
    this.notice = "";
    this.open = true;
  }

  close() {
    this.open = false;
  }

  async chooseFolder() {
    this.notice = "";
    try {
      const folder = await ChooseProfileSyncFolder();
      if (folder) this.folder = folder;
    } catch (error) {
      this.notice = String(error);
    }
  }

  async save() {
    this.busy = true;
    this.notice = "";
    try {
      await SavePreferences({
        profile_sync_enabled: this.syncEnabled,
        profile_sync_folder: this.folder,
      });
      this.open = false;
    } catch (error) {
      this.notice = String(error);
    } finally {
      this.busy = false;
    }
  }
}
