import { diffAgainstApplied, type ChangeKind } from "../domain/applyDiff";
import { isConnected } from "../domain/devices";
import { KeyCatalog } from "../domain/keyCatalog";
import {
  baseLayerID,
  editableState,
  isValidDeclarationName,
  Keymap,
} from "../domain/keymap";
import type { Recipe } from "../domain/recipes";
import { count } from "../domain/text";
import type { ValidationState } from "../domain/validation";
import {
  applyAssignmentRecovery,
  assignmentMatchesIssue,
  assignmentRecovery,
  mapDiagnosticToAssignment,
  withPreEditFallback,
  type MappedAssignmentIssue,
} from "../domain/validationRecovery";
import type {
  Device,
  Profile,
  ProfileBehavior,
  ProfilePreview,
} from "../platform/desktop";
import { ApplyController } from "./apply.svelte";
import type { ManagerConnection } from "./connection.svelte";
import { DraftHistory } from "./history.svelte";
import type { ProfileLibrary } from "./library.svelte";
import { PreviewValidator } from "./preview.svelte";
import type { ToastCenter } from "./toasts.svelte";

export type ComplexAction =
  | "tap_hold"
  | "layer"
  | "alias"
  | "macro"
  | "layers"
  | "recipes";
export type DraftSaveState = "saved" | "saving" | "failed";
/** A dialog-level validation message, shown inside the dialog. */
export type EditResult = { ok: true } | { ok: false; error: string };

const ok: EditResult = { ok: true };
const failure = (error: string): EditResult => ({ ok: false, error });

export interface EditorDependencies {
  library: ProfileLibrary;
  connection: ManagerConnection;
  toasts: ToastCenter;
  /** The keyboard whose profile is being edited. */
  device: () => Device | null;
  /** Starts the post-Apply safety timer. */
  startTrial: (configurationID: string) => void;
}

/**
 * One editing session: the active profile, the selected layer and key, and
 * every draft edit. Each edit is saved immediately (with undo history) and
 * then validated by the manager as a whole draft.
 */
export class DraftEditor {
  profile = $state.raw<Profile | null>(null);
  layerID = $state(baseLayerID);
  /** The primary selected key: the inspector and complex actions use it. */
  sourceKey = $state("");
  /** Keys selected together with the primary one (Ctrl- or Shift-click). */
  otherKeys = $state.raw<string[]>([]);
  saveState = $state<DraftSaveState>("saved");
  /** The complex-action dialog that is open, if any. */
  dialog = $state<ComplexAction | null>(null);
  /** Collapses the problems strip until the draft is valid again. */
  problemsHidden = $state(false);
  /** Highlights keys whose behavior differs from the last Apply. */
  showChanges = $state(false);

  readonly history = new DraftHistory();
  readonly preview: PreviewValidator;
  readonly apply: ApplyController;
  readonly #library: ProfileLibrary;
  readonly #connection: ManagerConnection;
  readonly #toasts: ToastCenter;
  readonly #device: () => Device | null;

  geometry = $derived(this.#geometryFor(this.profile));
  catalog = $derived(new KeyCatalog(this.geometry));
  keymap = $derived(
    this.profile ? new Keymap(this.profile, this.catalog) : null,
  );
  rows = $derived(
    [...new Set((this.geometry?.keys ?? []).map((key) => key.row))].sort(
      (left, right) => left - right,
    ),
  );
  activeLayer = $derived(this.keymap?.layer(this.layerID));
  /** Every selected key, the primary one last. */
  selectedKeys = $derived(
    this.sourceKey
      ? [
          ...this.otherKeys.filter((key) => key !== this.sourceKey),
          this.sourceKey,
        ]
      : [],
  );
  multipleSelected = $derived(this.selectedKeys.length > 1);
  selectedKey = $derived(
    this.geometry?.keys.find((key) => key.source_key === this.sourceKey),
  );
  selectedBehavior = $derived(
    this.sourceKey
      ? this.keymap?.behaviorAt(this.layerID, this.sourceKey)
      : undefined,
  );
  // Dependencies are assigned in the constructor; derived values read them
  // lazily, which `$derived.by` makes explicit.
  device = $derived.by(
    () => this.#connection.device(this.#device()?.id) ?? this.#device(),
  );
  linkedConfiguration = $derived.by(() =>
    this.#connection.configuration(this.profile?.manager_configuration_id),
  );
  /** The preview, only while it matches this draft and manager state. */
  currentPreview = $derived(this.#currentPreview());
  mappedIssues = $derived(this.#mappedIssues());
  validationState = $derived.by<ValidationState>(() =>
    this.currentPreview?.validation.outcome === "valid"
      ? "valid"
      : this.preview.busy
        ? "checking"
        : (this.currentPreview?.validation.outcome ?? "unchecked"),
  );
  /** Why Apply is unavailable; empty while possible or still checking. */
  applyBlockedReason = $derived(this.#applyBlocker());
  canApply = $derived(
    this.applyBlockedReason === "" && this.validationState === "valid",
  );
  applyDiff = $derived(
    this.profile
      ? diffAgainstApplied(this.profile.applied, this.profile)
      : null,
  );
  /** Unapplied key changes, keyed by layer and source key. */
  unappliedChanges = $derived.by(() => {
    const changes = new Map<string, ChangeKind>();
    for (const change of this.applyDiff?.assignments ?? []) {
      changes.set(`${change.layerID}\u0000${change.sourceKey}`, change.kind);
    }
    return changes;
  });
  /** The manager runs a different revision than this profile last applied. */
  appliedRevisionDrift = $derived(
    !!this.profile?.applied?.configuration_revision &&
      !!this.linkedConfiguration?.active_revision &&
      this.linkedConfiguration.active_revision !==
        this.profile.applied.configuration_revision,
  );
  applyOutcome = $derived.by(() =>
    this.apply.outcomeFor(this.profile, this.linkedConfiguration),
  );
  canUndo = $derived.by(
    () =>
      !!this.profile &&
      this.history.canUndo(this.profile.id) &&
      !this.#library.busy &&
      !this.profile.apply_pending,
  );
  canRedo = $derived.by(
    () =>
      !!this.profile &&
      this.history.canRedo(this.profile.id) &&
      !this.#library.busy &&
      !this.profile.apply_pending,
  );

  constructor(dependencies: EditorDependencies) {
    this.#library = dependencies.library;
    this.#connection = dependencies.connection;
    this.#toasts = dependencies.toasts;
    this.#device = dependencies.device;
    const editor = this;
    this.preview = new PreviewValidator({
      get profile() {
        return editor.profile;
      },
      canValidate: () =>
        this.#connection.capability("candidate_validation").available,
      previewAccepted: (result) => this.#acceptPreview(result),
      previewFailed: (error) => this.#toasts.error(error),
    });
    this.apply = new ApplyController({
      get profile() {
        return editor.profile;
      },
      get profiles() {
        return editor.#library.profiles;
      },
      get live() {
        return editor.#connection.live;
      },
      get canApply() {
        return editor.canApply;
      },
      profileUpdated: (profile) => this.#replace(profile),
      startTrial: (configurationID) => dependencies.startTrial(configurationID),
      refresh: () => this.#connection.refresh(),
      error: (error) => this.#toasts.error(error),
    });
  }

  get busy() {
    return this.#library.busy;
  }

  // Session lifecycle

  /** Starts editing a profile; a reopened draft is validated right away. */
  open(
    profile: Profile,
    selection: { layerID?: string; sourceKey?: string } = {},
  ) {
    this.profile = profile;
    this.layerID = profile.layers.some(
      (layer) => layer.id === selection.layerID,
    )
      ? selection.layerID!
      : baseLayerID;
    this.sourceKey = profile.geometry.source_keys.includes(
      selection.sourceKey ?? "",
    )
      ? selection.sourceKey!
      : "";
    this.otherKeys = [];
    this.saveState = "saved";
    this.dialog = null;
    this.preview.invalidate(false);
    this.apply.reset();
    this.preview.schedule(profile);
  }

  close() {
    this.profile = null;
    this.dialog = null;
    this.preview.invalidate(false);
    this.apply.reset();
  }

  /** Manager state changed under the draft; its preview is no longer current. */
  environmentChanged(live: boolean) {
    if (this.profile) this.preview.invalidate(live);
  }

  dispose() {
    this.preview.dispose();
    this.apply.dispose();
  }

  // Selection

  selectLayer(layerID: string) {
    this.layerID = layerID;
  }

  /**
   * A click on a key. Alone it selects only that key (or deselects it);
   * with `additive` it adds the key to, or removes it from, the selection.
   */
  toggleKey(sourceKey: string, additive = false) {
    if (!additive) {
      const onlyThis = this.sourceKey === sourceKey && !this.multipleSelected;
      this.otherKeys = [];
      this.sourceKey = onlyThis ? "" : sourceKey;
      return;
    }
    if (this.selectedKeys.includes(sourceKey)) {
      const remaining = this.selectedKeys.filter((key) => key !== sourceKey);
      this.sourceKey = remaining[remaining.length - 1] ?? "";
      this.otherKeys = remaining.slice(0, -1);
    } else {
      this.otherKeys = this.selectedKeys;
      this.sourceKey = sourceKey;
    }
  }

  select(layerID: string, sourceKey: string) {
    this.layerID = layerID;
    this.sourceKey = sourceKey;
    this.otherKeys = [];
  }

  clearSelection() {
    this.sourceKey = "";
    this.otherKeys = [];
  }

  // Saving and history

  /**
   * Saves a new revision of the active profile. Returns undefined when
   * another save is running or the save failed (the error is shown).
   */
  async save(
    draft: Profile,
    recordHistory = true,
  ): Promise<Profile | undefined> {
    if (this.#library.busy) return undefined;
    const current = this.profile?.id === draft.id ? this.profile : null;
    const before = current ? editableState(current) : null;
    const saveable = current ? withPreEditFallback(current, draft) : draft;
    this.saveState = "saving";
    this.preview.beginEdit();
    try {
      const saved = await this.#library.run(() => this.#library.save(saveable));
      this.#replace(saved);
      if (recordHistory && before) this.history.record(saved.id, before);
      this.saveState = "saved";
      this.preview.schedule(saved);
      return saved;
    } catch (error) {
      this.saveState = "failed";
      this.preview.abandonEdit();
      this.#toasts.error(error);
      return undefined;
    }
  }

  // Undo and redo are ordinary revision-guarded saves, so they refresh the
  // whole-draft preview exactly like any other edit.
  async undo() {
    const profile = this.profile;
    const previous = profile && this.history.previous(profile.id);
    if (!profile || !previous || !this.canUndo) return;
    const current = editableState(profile);
    const saved = await this.save({ ...profile, ...previous }, false);
    if (!saved) return;
    this.history.undone(saved.id, current);
    this.#reconcileSelection(saved);
  }

  async redo() {
    const profile = this.profile;
    const next = profile && this.history.next(profile.id);
    if (!profile || !next || !this.canRedo) return;
    const current = editableState(profile);
    const saved = await this.save({ ...profile, ...next }, false);
    if (!saved) return;
    this.history.redone(saved.id, current);
    this.#reconcileSelection(saved);
  }

  async rename(name: string) {
    if (!this.profile || !name.trim()) return;
    await this.save({ ...this.profile, name: name.trim() }, false);
  }

  // Key edits

  /** Gives every selected key the behavior, in one undoable save. */
  async assign(behavior: ProfileBehavior): Promise<boolean> {
    const keymap = this.keymap;
    if (!keymap || !this.sourceKey || this.#library.busy) return false;
    const draft = this.selectedKeys.reduce(
      (profile, sourceKey) =>
        keymap.withBehavior(this.layerID, sourceKey, behavior, profile),
      keymap.profile,
    );
    return Boolean(await this.save(draft));
  }

  /** Removes this layer's assignments for every selected key. */
  async restoreSelected() {
    const keymap = this.keymap;
    if (!keymap || !this.sourceKey || this.#library.busy) return;
    const keys = new Set(this.selectedKeys);
    await this.save({
      ...keymap.profile,
      assignments: keymap.assignments.filter(
        (assignment) =>
          assignment.layer_id !== this.layerID ||
          !keys.has(assignment.source_key),
      ),
    });
  }

  openDialog(kind: ComplexAction) {
    const needsKey = kind !== "layers" && kind !== "recipes";
    if (!this.profile || (needsKey && !this.sourceKey)) {
      this.#toasts.info(
        "Select a physical key before choosing a complex action.",
      );
      return;
    }
    if (needsKey && this.multipleSelected) {
      this.#toasts.info(
        "Complex actions apply to one key. Select a single key.",
      );
      return;
    }
    this.dialog = kind;
  }

  closeDialog() {
    this.dialog = null;
  }

  async defineAlias(
    name: string,
    key: string,
    editing: string,
  ): Promise<EditResult> {
    const keymap = this.keymap;
    if (!keymap || !key || !isValidDeclarationName(name)) {
      return failure(
        "Alias names must start with a letter and contain only letters, numbers, or hyphens.",
      );
    }
    if (name !== editing && keymap.hasDeclaration(name)) {
      return failure("That alias or macro name is already in use.");
    }
    const draft = keymap.withBehavior(
      this.layerID,
      this.sourceKey,
      { kind: "alias", target: name },
      keymap.withAlias(name, { kind: "key", key }),
    );
    return (await this.save(draft)) ? ok : failure("");
  }

  async defineMacro(
    name: string,
    steps: string[],
    editing: string,
  ): Promise<EditResult> {
    const keymap = this.keymap;
    if (!keymap || !isValidDeclarationName(name) || !steps.length) {
      return failure("A macro needs a valid name and at least one key press.");
    }
    if (name !== editing && keymap.hasDeclaration(name)) {
      return failure("That alias or macro name is already in use.");
    }
    const draft = keymap.withBehavior(
      this.layerID,
      this.sourceKey,
      { kind: "macro", target: name },
      keymap.withMacro(
        name,
        steps.map((key) => ({ kind: "key", key })),
      ),
    );
    return (await this.save(draft)) ? ok : failure("");
  }

  /** Adds a recipe's assignments to the draft as one undoable edit. */
  async applyRecipe(recipe: Recipe): Promise<boolean> {
    if (!this.keymap || this.#library.busy) return false;
    const saved = await this.save(recipe.apply(this.keymap));
    if (saved) {
      this.#toasts.success(
        `Added “${recipe.name}” to the draft. Undo removes it again.`,
      );
    }
    return Boolean(saved);
  }

  // Layer edits

  /** Adds and selects a layer; resolves to its ID, or an error message. */
  async createLayer(rawName: string): Promise<EditResult & { id?: string }> {
    const keymap = this.keymap;
    const name = rawName.trim();
    if (!keymap || !name) return failure("");
    if (keymap.layers.some((layer) => layer.name === name)) {
      return failure("A layer with that name already exists.");
    }
    const id = keymap.newLayerID(name);
    if (!(await this.save(keymap.withLayer({ id, name })))) return failure("");
    this.layerID = id;
    return { ok: true, id };
  }

  async renameLayer(rawName: string): Promise<EditResult> {
    const keymap = this.keymap;
    const name = rawName.trim();
    if (!keymap || !this.activeLayer || !name) return failure("");
    if (
      keymap.layers.some(
        (layer) => layer.id !== this.layerID && layer.name === name,
      )
    ) {
      return failure("A layer with that name already exists.");
    }
    await this.save(keymap.withLayerName(this.layerID, name));
    return ok;
  }

  async moveLayer(direction: -1 | 1) {
    const moved = this.keymap?.withLayerMoved(this.layerID, direction);
    if (moved) await this.save(moved);
  }

  async deleteLayer(): Promise<EditResult> {
    const keymap = this.keymap;
    if (!keymap || this.layerID === baseLayerID) {
      return failure("The Base layer is always required.");
    }
    const own = keymap.assignmentCount(this.layerID);
    const references = keymap.entryCount(this.layerID);
    if (own || references) {
      return failure(
        `Remove ${count(own, "assignment")} and ${count(references, "layer action")} before deleting this layer.`,
      );
    }
    if (await this.save(keymap.withoutLayer(this.layerID))) {
      this.layerID = baseLayerID;
    }
    return ok;
  }

  // Validation recovery

  diagnosticIssue(diagnosticID: string): MappedAssignmentIssue | null {
    const preview = this.currentPreview;
    const diagnostic = preview?.validation.diagnostics?.find(
      (candidate) => candidate.id === diagnosticID,
    );
    return this.profile && preview && diagnostic
      ? mapDiagnosticToAssignment(preview, diagnostic, this.profile)
      : null;
  }

  recoveryFor(issue: MappedAssignmentIssue) {
    if (!this.profile || !this.currentPreview) return null;
    return assignmentRecovery(
      this.profile,
      issue,
      this.currentPreview.manager_server_id,
    );
  }

  changeAt(layerID: string, sourceKey: string): ChangeKind | undefined {
    return this.unappliedChanges.get(`${layerID}\u0000${sourceKey}`);
  }

  layerHasChanges(layerID: string) {
    return (this.applyDiff?.assignments ?? []).some(
      (change) => change.layerID === layerID,
    );
  }

  isInvalidKey(sourceKey: string) {
    return this.mappedIssues.some(
      (issue) =>
        issue.layerID === this.layerID && issue.sourceKey === sourceKey,
    );
  }

  async revertIssue(diagnosticID: string) {
    const profile = this.profile;
    if (!profile || !this.currentPreview || this.#library.busy) return;
    const issue = this.diagnosticIssue(diagnosticID);
    if (!issue || !assignmentMatchesIssue(profile, issue)) {
      this.#toasts.error(
        "That recovery action is out of date. Check the current preview.",
      );
      return;
    }
    const recovery = this.recoveryFor(issue);
    if (!recovery?.available) {
      this.#toasts.error(
        recovery?.reason ?? "No safe assignment recovery is available.",
      );
      return;
    }
    if (await this.save(applyAssignmentRecovery(profile, issue, recovery))) {
      this.select(issue.layerID, issue.sourceKey);
      this.#toasts.success(
        `Restored ${issue.sourceKey} on ${this.keymap?.layerName(issue.layerID)}. Other draft edits were kept; checking the whole draft again.`,
      );
    }
  }

  // Internals

  #geometryFor(profile: Profile | null) {
    return profile ? this.#library.geometry(profile.geometry.id) : undefined;
  }

  /** Stores a newer copy of a profile, and adopts it if it is being edited. */
  #replace(profile: Profile) {
    this.#library.put(profile);
    if (this.profile?.id === profile.id) this.profile = profile;
  }

  #reconcileSelection(profile: Profile) {
    if (!profile.layers.some((layer) => layer.id === this.layerID)) {
      this.layerID = baseLayerID;
    }
  }

  #acceptPreview(result: ProfilePreview) {
    if (result.validation.outcome === "valid") this.problemsHidden = false;
    if (
      this.profile &&
      result.validation.outcome === "valid" &&
      result.validation_recovery
    ) {
      this.#replace({
        ...this.profile,
        validation_recovery: result.validation_recovery,
      });
    }
  }

  #currentPreview(): ProfilePreview | null {
    const preview = this.preview.preview;
    const workspace = this.#connection.workspace;
    return this.profile &&
      preview?.profile_id === this.profile.id &&
      preview.draft_revision === this.profile.draft_revision &&
      preview.manager_server_id === workspace.status.server_id &&
      preview.state_revision === workspace.snapshot?.state_revision &&
      this.#connection.live
      ? preview
      : null;
  }

  #mappedIssues(): MappedAssignmentIssue[] {
    const preview = this.currentPreview;
    const profile = this.profile;
    if (!profile || preview?.validation.outcome !== "rejected") return [];
    return (preview.validation.diagnostics ?? [])
      .map((diagnostic) =>
        mapDiagnosticToAssignment(preview, diagnostic, profile),
      )
      .filter((issue): issue is MappedAssignmentIssue => issue !== null);
  }

  /** The first reason Apply is unavailable, in priority order. */
  #applyBlocker(): string {
    const profile = this.profile;
    const device = this.device;
    const managed = this.#connection.capability("managed_configurations");
    const validation = this.#connection.capability("candidate_validation");
    if (!profile) return "";
    if (!this.#connection.live) return "the manager is not connected.";
    if (!managed.available)
      return `the manager cannot apply configurations: ${managed.reason}`;
    if (!device || !isConnected(device)) return "the keyboard is disconnected.";
    if (device.runtime_conflict)
      return "another configuration conflicts with this keyboard.";
    if (profile.apply_pending) return "an earlier Apply is still unresolved.";
    if (!validation.available)
      return `the manager cannot validate drafts: ${validation.reason}`;
    if (this.validationState === "rejected")
      return "the draft is invalid. Fix the problems below.";
    if (this.validationState === "blocked")
      return "validation is blocked. See the problem below.";
    return "";
  }
}
