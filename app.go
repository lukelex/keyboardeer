package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"sync"
	"time"

	"github.com/lukelex/keyboardeer/internal/compiler"
	"github.com/lukelex/keyboardeer/internal/geometry"
	"github.com/lukelex/keyboardeer/internal/managerapi"
	"github.com/lukelex/keyboardeer/internal/profile"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

const appVersion = "0.1.0-dev"

const (
	workspaceRefreshInterval = 15 * time.Second
	workspaceRetryInterval   = 2 * time.Second
)

// App is deliberately small: platform input and KMonad process management
// belong to kmonad-device-manager, not the desktop application.
type App struct {
	ctx               context.Context
	manager           *managerapi.APIClient
	profiles          *profile.Store
	eventCursors      *managerapi.EventCursorStore
	profileStoreError error
	monitorMu         sync.Mutex
	monitor           *managerapi.EventSubscription
	monitorGeneration uint64
	workspaceMu       sync.Mutex
	workspaceLoadMu   sync.Mutex
	lastWorkspace     *managerapi.Workspace
	refreshTimer      *time.Timer
	refreshDue        time.Time
	shuttingDown      bool
}

type AppInfo struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

func NewApp() *App {
	path, err := profile.DefaultPath()
	app := &App{manager: managerapi.New(managerapi.Options{
		ClientName:    "keyboardeer",
		ClientVersion: appVersion,
	}), profileStoreError: err}
	if err == nil {
		app.profiles = profile.NewStore(path)
		app.eventCursors = managerapi.NewEventCursorStore(filepath.Join(filepath.Dir(path), "event-cursor.json"))
	}
	return app
}

func newAppWithProfileStore(store *profile.Store) *App {
	return &App{
		manager:      managerapi.New(managerapi.Options{ClientName: "keyboardeer", ClientVersion: appVersion}),
		profiles:     store,
		eventCursors: managerapi.NewEventCursorStore(filepath.Join(filepath.Dir(store.Path()), "event-cursor.json")),
	}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.restoreWindowState()
}

// beforeClose persists the desktop shell's placement and allows Wails to quit.
// The manager is an independent service and continues supervising mappings.
func (a *App) beforeClose(context.Context) bool {
	a.saveWindowState()
	return false
}

func (a *App) shutdown(context.Context) {
	a.monitorMu.Lock()
	a.shuttingDown = true
	monitor := a.monitor
	a.monitor = nil
	a.monitorGeneration++
	refreshTimer := a.refreshTimer
	a.refreshTimer = nil
	a.monitorMu.Unlock()
	if refreshTimer != nil {
		refreshTimer.Stop()
	}
	if monitor != nil {
		_ = monitor.Close()
	}
	_ = a.manager.Close()
}

// Info gives the frontend a stable, side-effect-free binding.
func (a *App) Info() AppInfo {
	return AppInfo{Name: "KeyboarDeer", Version: appVersion}
}

// Geometries returns only layouts whose visual keys and KMonad source order
// have been explicitly verified. It does not infer a layout from device names.
func (a *App) Geometries() []geometry.Template { return geometry.List() }

// Profiles are application-owned editable drafts. None of these methods access
// a device or mutate a manager configuration.
func (a *App) Profiles() ([]profile.Profile, error) {
	store, err := a.profileStore()
	if err != nil {
		return nil, err
	}
	data, err := store.Load()
	if err != nil {
		return nil, err
	}
	return data.Profiles, nil
}

func (a *App) CreateProfile(deviceID, name, geometryID string) (profile.Profile, error) {
	store, err := a.profileStore()
	if err != nil {
		return profile.Profile{}, err
	}
	template, found := geometry.Lookup(geometryID)
	if !found {
		return profile.Profile{}, fmt.Errorf("unknown verified geometry %q", geometryID)
	}
	profileGeometry, err := template.ProfileGeometry()
	if err != nil {
		return profile.Profile{}, err
	}
	draft, err := profile.New(deviceID, name, profileGeometry)
	if err != nil {
		return profile.Profile{}, err
	}
	return store.Upsert(draft)
}

func (a *App) SaveProfile(draft profile.Profile) (profile.Profile, error) {
	store, err := a.profileStore()
	if err != nil {
		return profile.Profile{}, err
	}
	current, err := a.profileByID(draft.ID)
	if err != nil {
		return profile.Profile{}, err
	}
	if current.ApplyPending != nil {
		return profile.Profile{}, fmt.Errorf("this profile has an apply with an unknown outcome; refresh the manager and resolve it before editing")
	}
	// Device and geometry define what every assignment means; changing them
	// would silently reinterpret the draft. They are fixed at creation.
	if draft.DeviceID != current.DeviceID || draft.Geometry.ID != current.Geometry.ID || !slices.Equal(draft.Geometry.SourceKeys, current.Geometry.SourceKeys) {
		return profile.Profile{}, fmt.Errorf("a profile's keyboard and physical layout cannot be changed after it is created")
	}
	// Manager references are written only by the apply workflow, never by an
	// ordinary draft edit from the frontend.
	draft.ManagerConfigurationID = current.ManagerConfigurationID
	draft.ApplyPending = current.ApplyPending
	return store.Upsert(draft)
}

// ProfileStoreStatus explains why saved drafts could not be loaded, so the UI
// can offer recovery only when it is safe: a corrupt store may be backed up and
// reset, but a store written by a newer KeyboarDeer must never be reset.
type ProfileStoreStatus struct {
	State   string `json:"state"`
	Message string `json:"message"`
	Path    string `json:"path,omitempty"`
}

func (a *App) ProfileStoreStatus() ProfileStoreStatus {
	store, err := a.profileStore()
	if err != nil {
		return ProfileStoreStatus{State: "unavailable", Message: err.Error()}
	}
	_, err = store.Load()
	var corrupt *profile.CorruptStoreError
	var unsupported *profile.UnsupportedStoreVersionError
	switch {
	case err == nil:
		return ProfileStoreStatus{State: "ok", Path: store.Path()}
	case errors.As(err, &corrupt):
		return ProfileStoreStatus{State: "corrupt", Path: store.Path(), Message: "Saved keyboard drafts could not be read. The file may be damaged."}
	case errors.As(err, &unsupported):
		return ProfileStoreStatus{State: "unsupported", Path: store.Path(), Message: "Saved keyboard drafts were written by a newer KeyboarDeer. Update KeyboarDeer to open them."}
	default:
		return ProfileStoreStatus{State: "unavailable", Path: store.Path(), Message: err.Error()}
	}
}

// SelectedProfiles maps each keyboard's manager device ID to the profile that
// is opened for it.
func (a *App) SelectedProfiles() (map[string]string, error) {
	store, err := a.profileStore()
	if err != nil {
		return nil, err
	}
	data, err := store.Load()
	if err != nil {
		return nil, err
	}
	if data.Selected == nil {
		return map[string]string{}, nil
	}
	return data.Selected, nil
}

// SelectProfile switches which of a keyboard's profiles is opened. Drafts are
// saved on every edit, so switching never discards pending changes; it also
// does not apply anything to the keyboard.
func (a *App) SelectProfile(deviceID, profileID string) error {
	store, err := a.profileStore()
	if err != nil {
		return err
	}
	return store.Select(deviceID, profileID)
}

// DuplicateProfile copies a profile's editable model into a new local draft
// for the same keyboard. The copy has no manager link.
func (a *App) DuplicateProfile(id, name string) (profile.Profile, error) {
	store, err := a.profileStore()
	if err != nil {
		return profile.Profile{}, err
	}
	source, err := a.profileByID(id)
	if err != nil {
		return profile.Profile{}, err
	}
	copied, err := profile.New(source.DeviceID, name, source.Geometry)
	if err != nil {
		return profile.Profile{}, err
	}
	// A JSON round trip deep-copies behaviors, including nested tap/hold
	// pointers, so the two drafts never share mutable state.
	encoded, err := json.Marshal(struct {
		Layers      []profile.Layer               `json:"layers"`
		Assignments []profile.Assignment          `json:"assignments"`
		Aliases     map[string]profile.Behavior   `json:"aliases"`
		Macros      map[string][]profile.Behavior `json:"macros"`
	}{source.Layers, source.Assignments, source.Aliases, source.Macros})
	if err != nil {
		return profile.Profile{}, err
	}
	if err := json.Unmarshal(encoded, &copied); err != nil {
		return profile.Profile{}, err
	}
	copied.Settings = source.Settings
	return store.Upsert(copied)
}

// ExportProfile writes a portable behavior-only profile file. It never emits
// generated KMonad text, which requires manager-owned device rendering.
func (a *App) ExportProfile(id string) error {
	if a.ctx == nil {
		return fmt.Errorf("desktop file dialogs are unavailable")
	}
	draft, err := a.profileByID(id)
	if err != nil {
		return err
	}
	defaultName := filepath.Base(draft.Name)
	if defaultName == "." || defaultName == string(filepath.Separator) {
		defaultName = "keyboard-profile"
	}
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Export KeyboarDeer profile",
		DefaultFilename: defaultName + ".kbdprofile.json",
		Filters:         []runtime.FileFilter{{DisplayName: "KeyboarDeer profile", Pattern: "*.kbdprofile.json"}},
	})
	if err != nil || path == "" {
		return err
	}
	data, err := profile.Export(draft)
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o600)
}

// ImportProfile imports behavior into a new draft for the chosen keyboard.
// Manager links and apply state are never imported from portable files.
func (a *App) ImportProfile(deviceID string) (profile.Profile, error) {
	if a.ctx == nil {
		return profile.Profile{}, fmt.Errorf("desktop file dialogs are unavailable")
	}
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title:   "Import KeyboarDeer profile",
		Filters: []runtime.FileFilter{{DisplayName: "KeyboarDeer profile", Pattern: "*.kbdprofile.json"}},
	})
	if err != nil || path == "" {
		return profile.Profile{}, err
	}
	info, err := os.Stat(path)
	if err != nil {
		return profile.Profile{}, err
	}
	if info.Size() > 4<<20 {
		return profile.Profile{}, fmt.Errorf("profile file exceeds 4 MiB")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return profile.Profile{}, err
	}
	draft, err := profile.Import(data, deviceID)
	if err != nil {
		return profile.Profile{}, err
	}
	draft = geometry.MigrateLegacyProfile(draft)
	template, ok := geometry.Lookup(draft.Geometry.ID)
	if !ok {
		return profile.Profile{}, fmt.Errorf("profile uses an unsupported verified geometry %q", draft.Geometry.ID)
	}
	verified, err := template.ProfileGeometry()
	if err != nil || !slices.Equal(verified.SourceKeys, draft.Geometry.SourceKeys) {
		return profile.Profile{}, fmt.Errorf("profile geometry does not match a verified keyboard layout")
	}
	store, err := a.profileStore()
	if err != nil {
		return profile.Profile{}, err
	}
	storeData, err := store.Load()
	if err != nil {
		return profile.Profile{}, err
	}
	compatible := false
	for _, existing := range storeData.ProfilesForDevice(deviceID) {
		if existing.Geometry.ID == draft.Geometry.ID && slices.Equal(existing.Geometry.SourceKeys, draft.Geometry.SourceKeys) {
			compatible = true
			break
		}
	}
	if !compatible {
		return profile.Profile{}, fmt.Errorf("imported layout does not match a profile already associated with this keyboard")
	}
	return store.Upsert(draft)
}

func (a *App) DeleteProfile(id string, expectedDraftRevision uint64) error {
	store, err := a.profileStore()
	if err != nil {
		return err
	}
	return store.Delete(id, expectedDraftRevision)
}

func (a *App) CompileProfile(id string) (compiler.Result, error) {
	draft, err := a.profileByID(id)
	if err != nil {
		return compiler.Result{}, err
	}
	return compiler.Compile(draft)
}

// ProfilePreview is correlated to the exact local draft and manager generation
// used for the check. The UI must discard it after any local edit, device
// change, or manager server-ID change; validity never implies activation.
type ProfilePreview struct {
	ProfileID          string                      `json:"profile_id"`
	DraftRevision      uint64                      `json:"draft_revision"`
	DeviceID           string                      `json:"device_id"`
	ManagerServerID    string                      `json:"manager_server_id"`
	StateRevision      uint64                      `json:"state_revision"`
	CandidateDigest    string                      `json:"candidate_digest"`
	ValidationRecovery *profile.ValidationRecovery `json:"validation_recovery,omitempty"`
	Validation         managerapi.ValidationResult `json:"validation"`
	SourceMap          []compiler.SourceMapEntry   `json:"source_map"`
}

func (a *App) PreviewProfile(id string) (ProfilePreview, error) {
	draft, err := a.profileByID(id)
	if err != nil {
		return ProfilePreview{}, err
	}
	compiled, err := compiler.Compile(draft)
	if err != nil {
		return ProfilePreview{}, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	before, err := a.manager.ManagerGet(ctx)
	if err != nil {
		return ProfilePreview{}, err
	}
	available, reason := managerapi.CapabilityAvailable(before.Capabilities, "candidate_validation")
	if !available {
		return ProfilePreview{}, &managerapi.Error{Code: "unsupported_capability", Message: reason}
	}
	preview, err := a.manager.Preview(ctx, managerapi.PreviewParams{Model: &managerapi.PreviewModel{DeviceID: draft.DeviceID, Behavior: compiled.Behavior}})
	if err != nil {
		return ProfilePreview{}, err
	}
	after, err := a.manager.ManagerGet(ctx)
	if err != nil {
		return ProfilePreview{}, err
	}
	if before.ServerID != after.ServerID {
		return ProfilePreview{}, &managerapi.Error{Code: "manager_restarted", Message: "The manager restarted while it validated this draft."}
	}
	if before.StateRevision != after.StateRevision || !slices.Equal(before.Capabilities, after.Capabilities) {
		return ProfilePreview{}, &managerapi.Error{Code: "manager_state_changed", Message: "The manager state or capabilities changed while it validated this draft."}
	}
	digest := sha256.Sum256([]byte(compiled.Behavior))
	candidateDigest := "sha256:" + hex.EncodeToString(digest[:])
	if preview.Validation.CandidateDigest != "" && preview.Validation.CandidateDigest != candidateDigest {
		return ProfilePreview{}, &managerapi.Error{Code: "candidate_digest_mismatch", Message: "The manager validation result does not match the submitted draft."}
	}
	recovery := draft.ValidationRecovery
	if preview.Validation.Outcome == "valid" {
		checkpoint := profile.ValidationCheckpoint{
			DraftRevision: draft.DraftRevision, ManagerServerID: after.ServerID,
			CandidateDigest: candidateDigest, Geometry: draft.Geometry,
			Layers: draft.Layers, Assignments: draft.Assignments,
			Aliases: draft.Aliases, Macros: draft.Macros,
		}
		// Recovery persistence is additive: an I/O failure must not turn a
		// manager-approved preview into a validation failure. The existing
		// recovery metadata remains in the response, but no new checkpoint is
		// advertised unless the exact draft revision was saved.
		if saved, saveErr := a.profiles.SetValidationCheckpoint(draft.ID, draft.DraftRevision, checkpoint); saveErr == nil {
			recovery = saved.ValidationRecovery
		}
	}
	return ProfilePreview{
		ProfileID: draft.ID, DraftRevision: draft.DraftRevision, DeviceID: draft.DeviceID,
		ManagerServerID: after.ServerID, StateRevision: after.StateRevision,
		CandidateDigest: candidateDigest, ValidationRecovery: recovery,
		Validation: preview.Validation, SourceMap: compiled.SourceMap,
	}, nil
}

// ProfileApplyResult links a manager operation to the local draft. The UI
// displays the manager-owned outcome rather than assuming that a successful
// validation means activation.
type ProfileApplyResult struct {
	Profile   profile.Profile      `json:"profile"`
	Operation managerapi.Operation `json:"operation"`
	// Stale reports that the keyboard's configuration changed on the manager
	// between review and apply. Nothing was applied; the user should review
	// the refreshed state and apply again.
	Stale bool `json:"stale,omitempty"`
	// Uncertain reports that the manager did not confirm the request. The
	// exact request is kept and can be replayed safely with ResumeApply.
	Uncertain bool `json:"uncertain,omitempty"`
}

// applyRetryDelays bounds automatic replays of an unconfirmed mutation. Each
// replay reuses the same idempotency key, so the manager never applies twice.
var applyRetryDelays = []time.Duration{250 * time.Millisecond, time.Second}

// ApplyProfile creates or updates the manager-owned configuration associated
// with this local profile. It never accesses a device or writes a .kbd file.
// The request and its idempotency key are persisted before sending, so a lost
// response or GUI restart is recovered by replaying the identical request.
func (a *App) ApplyProfile(id string) (ProfileApplyResult, error) {
	store, err := a.profileStore()
	if err != nil {
		return ProfileApplyResult{}, err
	}
	draft, err := a.profileByID(id)
	if err != nil {
		return ProfileApplyResult{}, err
	}
	if draft.ApplyPending != nil {
		if draft.ApplyPending.Replayable() {
			return a.ResumeApply(id)
		}
		return ProfileApplyResult{}, fmt.Errorf("the previous apply outcome is unknown since %s; KeyboarDeer will not retry it", draft.ApplyPending.StartedAt.Format(time.RFC3339))
	}
	compiled, err := compiler.Compile(draft)
	if err != nil {
		return ProfileApplyResult{}, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	info, err := a.manager.ManagerGet(ctx)
	if err != nil {
		return ProfileApplyResult{}, err
	}
	available, reason := managerapi.CapabilityAvailable(info.Capabilities, "managed_configurations")
	if !available {
		return ProfileApplyResult{}, &managerapi.Error{Code: "unsupported_capability", Message: reason}
	}
	snapshot, err := a.manager.SnapshotGet(ctx)
	if err != nil {
		return ProfileApplyResult{}, err
	}
	// A keyboard has one managed configuration. Applying a different profile
	// of the same keyboard updates that configuration and moves its link,
	// instead of creating a second configuration that would claim the device.
	configurationID := draft.ManagerConfigurationID
	library, err := store.Load()
	if err != nil {
		return ProfileApplyResult{}, err
	}
	for _, sibling := range library.ProfilesForDevice(draft.DeviceID) {
		if sibling.ID == draft.ID {
			continue
		}
		if sibling.ApplyPending != nil {
			return ProfileApplyResult{}, fmt.Errorf("profile %q has an apply with an unknown outcome for this keyboard; KeyboarDeer will not apply another profile until it is resolved", sibling.Name)
		}
		if configurationID == "" && sibling.ManagerConfigurationID != "" {
			configurationID = sibling.ManagerConfigurationID
		}
	}
	var expected *uint64
	if configurationID != "" {
		var configuration *managerapi.Configuration
		for index := range snapshot.Configurations {
			candidate := &snapshot.Configurations[index]
			if candidate.ID == configurationID {
				configuration = candidate
				break
			}
		}
		if configuration == nil {
			return ProfileApplyResult{}, fmt.Errorf("the manager configuration linked to this profile no longer exists; KeyboarDeer will not create a replacement automatically")
		}
		if configuration.Ownership != "managed" {
			return ProfileApplyResult{}, fmt.Errorf("the configuration linked to this profile is no longer manager-owned")
		}
		revision := configuration.DesiredRevision
		expected = &revision
	}
	params := managerapi.ConfigurationWriteParams{
		ConfigurationID:  configurationID,
		Name:             draft.Name,
		Model:            managerapi.PreviewModel{DeviceID: draft.DeviceID, Behavior: compiled.Behavior},
		ExpectedRevision: expected,
	}
	method := "configuration.create"
	if configurationID != "" {
		method = "configuration.update"
	}
	request, err := json.Marshal(params)
	if err != nil {
		return ProfileApplyResult{}, err
	}
	pending, err := store.SetApplyState(draft.ID, draft.DraftRevision, "", &profile.PendingApply{
		ManagerServerID:      info.ServerID,
		StartedAt:            time.Now().UTC(),
		IdempotencyKey:       managerapi.NewIdempotencyKey(),
		IdempotencySupported: managerapi.SupportsDurableMutationIdempotency(info.ManagerVersion),
		Method:               method,
		Request:              request,
	})
	if err != nil {
		return ProfileApplyResult{}, err
	}
	return a.sendPendingApply(ctx, store, pending)
}

// ResumeApply recovers a profile's unconfirmed apply. Once accepted, it follows
// the saved operation ID; before acceptance is known, it replays the exact
// request only when the original manager version guarantees durable idempotency.
func (a *App) ResumeApply(id string) (ProfileApplyResult, error) {
	store, err := a.profileStore()
	if err != nil {
		return ProfileApplyResult{}, err
	}
	draft, err := a.profileByID(id)
	if err != nil {
		return ProfileApplyResult{}, err
	}
	if draft.ApplyPending == nil {
		return ProfileApplyResult{Profile: draft}, nil
	}
	if !draft.ApplyPending.HasReplayableRequest() {
		return ProfileApplyResult{}, fmt.Errorf("this apply was sent by an older KeyboarDeer without a recovery request and cannot be replayed")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	info, err := a.manager.ManagerGet(ctx)
	if err != nil {
		return ProfileApplyResult{}, err
	}
	if info.ServerID != draft.ApplyPending.ManagerServerID {
		return ProfileApplyResult{}, fmt.Errorf("this apply belongs to manager %q, but the connected manager is %q; KeyboarDeer kept it pending and did not replay it", draft.ApplyPending.ManagerServerID, info.ServerID)
	}
	// Once an operation ID is known, query that accepted operation directly.
	// In particular, this works after a manager restart, when the manager marks
	// interrupted work failed and restores the durable operation journal.
	if draft.ApplyPending.OperationID != "" {
		operation, err := a.manager.OperationGet(ctx, draft.ApplyPending.OperationID)
		if err == nil {
			return a.recordApplyOperation(store, draft, operation)
		}
		var managerError *managerapi.Error
		if errors.As(err, &managerError) && managerError.Code == "not_found" {
			// Do not replay: a retained idempotency record could have expired, in
			// which case replaying could create a second operation.
			return ProfileApplyResult{}, fmt.Errorf("manager no longer retains accepted operation %q; the apply remains pending and was not replayed: %w", draft.ApplyPending.OperationID, err)
		}
		return ProfileApplyResult{}, err
	}
	if !draft.ApplyPending.IdempotencySupported {
		return ProfileApplyResult{}, fmt.Errorf("the manager version that received this apply does not guarantee durable idempotency; KeyboarDeer kept it pending and will not replay it")
	}
	return a.sendPendingApply(ctx, store, draft)
}

// DiscardPendingApply clears an unconfirmed request only after the user
// acknowledges checking the keyboard. A safely replayable request without an
// accepted operation ID must be recovered with ResumeApply instead.
func (a *App) DiscardPendingApply(id string) (profile.Profile, error) {
	store, err := a.profileStore()
	if err != nil {
		return profile.Profile{}, err
	}
	draft, err := a.profileByID(id)
	if err != nil {
		return profile.Profile{}, err
	}
	if draft.ApplyPending == nil {
		return draft, nil
	}
	if draft.ApplyPending.Replayable() && draft.ApplyPending.OperationID == "" {
		return profile.Profile{}, fmt.Errorf("this apply can be checked safely; use Check apply outcome instead of clearing it")
	}
	configurationID := ""
	if len(draft.ApplyPending.Request) != 0 {
		var params managerapi.ConfigurationWriteParams
		if json.Unmarshal(draft.ApplyPending.Request, &params) == nil {
			configurationID = params.ConfigurationID
		}
	}
	reason := "The apply outcome was not confirmed. After checking the keyboard, you cleared this unresolved request; KeyboarDeer did not replay it."
	if draft.ApplyPending.OperationID != "" {
		reason = "The outcome of this accepted operation was not recovered. After checking the keyboard, you cleared its tracking record; this did not cancel manager work."
	}
	return store.SetApplyOutcome(draft.ID, draft.DraftRevision, configurationID, profile.ApplyOutcome{
		ID:         draft.ApplyPending.OperationID,
		Kind:       "apply",
		State:      "unknown",
		ReasonCode: "apply_outcome_unknown",
		Reason:     reason,
	})
}

func (a *App) sendPendingApply(ctx context.Context, store *profile.Store, pending profile.Profile) (ProfileApplyResult, error) {
	record := pending.ApplyPending
	info, err := a.manager.ManagerGet(ctx)
	if err != nil {
		return ProfileApplyResult{Profile: pending, Uncertain: true}, nil
	}
	if info.ServerID != record.ManagerServerID {
		return ProfileApplyResult{}, fmt.Errorf("this apply belongs to manager %q, but the connected manager is %q; KeyboarDeer kept it pending and did not send it", record.ManagerServerID, info.ServerID)
	}
	var params managerapi.ConfigurationWriteParams
	if err := json.Unmarshal(record.Request, &params); err != nil {
		return ProfileApplyResult{}, fmt.Errorf("decode pending apply request: %w", err)
	}
	var operation managerapi.Operation
	err = nil
	for attempt := 0; ; attempt++ {
		if record.Method == "configuration.create" {
			operation, err = a.manager.ConfigurationCreate(ctx, params, record.IdempotencyKey)
		} else {
			operation, err = a.manager.ConfigurationUpdate(ctx, params, record.IdempotencyKey)
		}
		if err == nil || !uncertainMutationError(err) || !record.IdempotencySupported || attempt >= len(applyRetryDelays) {
			break
		}
		select {
		case <-ctx.Done():
		case <-time.After(applyRetryDelays[attempt]):
		}
		if ctx.Err() != nil {
			break
		}
		info, checkErr := a.manager.ManagerGet(ctx)
		if checkErr != nil || info.ServerID != record.ManagerServerID {
			return ProfileApplyResult{Profile: pending, Uncertain: true}, nil
		}
	}
	if err != nil {
		if uncertainMutationError(err) {
			// Keep the exact request: replaying it later is safe.
			return ProfileApplyResult{Profile: pending, Uncertain: true}, nil
		}
		cleared, saveErr := store.SetApplyState(pending.ID, pending.DraftRevision, "", nil)
		if saveErr != nil {
			return ProfileApplyResult{}, fmt.Errorf("apply was not performed (%w); also could not clear the local pending state: %v", err, saveErr)
		}
		var managerError *managerapi.Error
		if errors.As(err, &managerError) && managerError.Code == "stale_revision" {
			return ProfileApplyResult{Profile: cleared, Stale: true}, nil
		}
		return ProfileApplyResult{}, err
	}
	return a.recordApplyOperation(store, pending, operation)
}

// recordApplyOperation stores the manager's answer. A running operation keeps
// the pending record (with its operation ID) so it can be followed later.
func (a *App) recordApplyOperation(store *profile.Store, pending profile.Profile, operation managerapi.Operation) (ProfileApplyResult, error) {
	if !terminalOperation(operation.State) {
		record := *pending.ApplyPending
		record.OperationID = operation.ID
		updated, err := store.SetApplyState(pending.ID, pending.DraftRevision, "", &record)
		if err != nil {
			return ProfileApplyResult{}, err
		}
		return ProfileApplyResult{Profile: updated, Operation: operation}, nil
	}
	// Preserve the existing configuration association for update outcomes,
	// including rejection. A rejected create has no configuration to link.
	var params managerapi.ConfigurationWriteParams
	if err := json.Unmarshal(pending.ApplyPending.Request, &params); err != nil {
		return ProfileApplyResult{}, fmt.Errorf("decode completed apply request: %w", err)
	}
	linkedID := params.ConfigurationID
	if linkedID == "" && operation.State != "rejected" && operation.Resource != nil && operation.Resource.Kind == "configuration" {
		linkedID = operation.Resource.ID
	}
	outcome := profile.ApplyOutcome{
		ID:                    operation.ID,
		Kind:                  operation.Kind,
		State:                 operation.State,
		StartedAt:             operation.StartedAt,
		UpdatedAt:             operation.UpdatedAt,
		ReasonCode:            operation.ReasonCode,
		Reason:                operation.Reason,
		ConfigurationRevision: operation.ConfigurationRevision,
	}
	if operation.Resource != nil {
		outcome.Resource = &profile.ApplyResource{Kind: operation.Resource.Kind, ID: operation.Resource.ID}
	}
	linked, err := store.SetApplyOutcome(pending.ID, pending.DraftRevision, linkedID, outcome)
	if err != nil {
		return ProfileApplyResult{}, fmt.Errorf("manager apply finished but KeyboarDeer could not save its configuration link: %w", err)
	}
	return ProfileApplyResult{Profile: linked, Operation: operation}, nil
}

// uncertainMutationError reports whether a mutation may or may not have
// reached the manager. Structured manager errors are definite answers.
func uncertainMutationError(err error) bool {
	var managerError *managerapi.Error
	if errors.As(err, &managerError) {
		return managerError.Code == "transport" || managerError.Code == "temporary_unavailable"
	}
	return true
}

func terminalOperation(state string) bool {
	switch state {
	case "succeeded", "rejected", "failed", "rolled_back", "cancelled":
		return true
	}
	return false
}

// mutationWithRetry sends a single-shot lifecycle mutation with one key,
// replaying it if the response is lost.
func (a *App) mutationWithRetry(ctx context.Context, send func(key string) (managerapi.Operation, error)) (managerapi.Operation, error) {
	info, err := a.manager.ManagerGet(ctx)
	if err != nil {
		return managerapi.Operation{}, err
	}
	key := managerapi.NewIdempotencyKey()
	if !managerapi.SupportsDurableMutationIdempotency(info.ManagerVersion) {
		return send(key)
	}
	for attempt := 0; ; attempt++ {
		operation, err := send(key)
		if err == nil || !uncertainMutationError(err) || attempt >= len(applyRetryDelays) {
			return operation, err
		}
		select {
		case <-ctx.Done():
			return operation, err
		case <-time.After(applyRetryDelays[attempt]):
		}
		current, checkErr := a.manager.ManagerGet(ctx)
		if checkErr != nil || current.ServerID != info.ServerID {
			return operation, err
		}
	}
}

// SetConfigurationEnabled starts or stops a manager-owned binding. External
// configurations remain read-only in KeyboarDeer. A fresh snapshot supplies
// the expected revision, so the manager rejects any competing lifecycle edit.
func (a *App) SetConfigurationEnabled(configurationID string, enabled bool) (managerapi.Operation, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := a.canUse(ctx, "managed_configurations"); err != nil {
		return managerapi.Operation{}, err
	}
	snapshot, err := a.manager.SnapshotGet(ctx)
	if err != nil {
		return managerapi.Operation{}, err
	}
	for _, configuration := range snapshot.Configurations {
		if configuration.ID != configurationID {
			continue
		}
		if configuration.Ownership != "managed" {
			return managerapi.Operation{}, fmt.Errorf("external configurations are read-only in KeyboarDeer")
		}
		params := managerapi.ConfigurationSetEnabledParams{
			ConfigurationID:  configuration.ID,
			ExpectedRevision: configuration.DesiredRevision,
			Enabled:          enabled,
		}
		return a.mutationWithRetry(ctx, func(key string) (managerapi.Operation, error) {
			return a.manager.ConfigurationSetEnabled(ctx, params, key)
		})
	}
	return managerapi.Operation{}, fmt.Errorf("manager configuration %q does not exist", configurationID)
}

// ExportConfiguration returns a manager-rendered, device-bound .kbd artifact
// for a managed configuration. The GUI never constructs device-specific defcfg.
func (a *App) ExportConfiguration(configurationID string) (managerapi.ConfigurationExportResult, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := a.canUse(ctx, "configuration_export"); err != nil {
		return managerapi.ConfigurationExportResult{}, err
	}
	snapshot, err := a.manager.SnapshotGet(ctx)
	if err != nil {
		return managerapi.ConfigurationExportResult{}, err
	}
	for _, configuration := range snapshot.Configurations {
		if configuration.ID != configurationID {
			continue
		}
		if configuration.Ownership != "managed" {
			return managerapi.ConfigurationExportResult{}, fmt.Errorf("raw source is available only for manager-rendered managed configurations")
		}
		return a.manager.ConfigurationExport(ctx, managerapi.ConfigurationExportParams{
			ConfigurationID: configuration.ID,
			Format:          "manager_rendered_kbd",
		})
	}
	return managerapi.ConfigurationExportResult{}, fmt.Errorf("manager configuration %q does not exist", configurationID)
}

// DeleteConfiguration stops a manager-owned mapping and removes it from the
// manager. It is deliberately separate from DeleteProfile: KeyboarDeer
// profiles are kept, and only their link to the removed configuration is
// cleared so a later Apply creates a fresh configuration.
func (a *App) DeleteConfiguration(configurationID string) (managerapi.Operation, error) {
	store, err := a.profileStore()
	if err != nil {
		return managerapi.Operation{}, err
	}
	library, err := store.Load()
	if err != nil {
		return managerapi.Operation{}, err
	}
	for _, draft := range library.Profiles {
		if draft.ManagerConfigurationID == configurationID && draft.ApplyPending != nil {
			return managerapi.Operation{}, fmt.Errorf("profile %q has an apply with an unknown outcome; resolve it before removing this mapping", draft.Name)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := a.canUse(ctx, "managed_configurations"); err != nil {
		return managerapi.Operation{}, err
	}
	snapshot, err := a.manager.SnapshotGet(ctx)
	if err != nil {
		return managerapi.Operation{}, err
	}
	for _, configuration := range snapshot.Configurations {
		if configuration.ID != configurationID {
			continue
		}
		if configuration.Ownership != "managed" {
			return managerapi.Operation{}, fmt.Errorf("external configurations are read-only in KeyboarDeer")
		}
		params := managerapi.ConfigurationDeleteParams{
			ConfigurationID:  configuration.ID,
			ExpectedRevision: configuration.DesiredRevision,
		}
		operation, err := a.mutationWithRetry(ctx, func(key string) (managerapi.Operation, error) {
			return a.manager.ConfigurationDelete(ctx, params, key)
		})
		if err != nil {
			return managerapi.Operation{}, err
		}
		if operation.State == "succeeded" {
			if err := store.ClearConfigurationLink(configuration.ID); err != nil {
				return operation, fmt.Errorf("the mapping was removed, but KeyboarDeer could not update its profile link: %w", err)
			}
		}
		return operation, nil
	}
	return managerapi.Operation{}, fmt.Errorf("manager configuration %q does not exist", configurationID)
}

func (a *App) RecoverCorruptProfileStore() (string, error) {
	store, err := a.profileStore()
	if err != nil {
		return "", err
	}
	return store.BackupAndReset()
}

func (a *App) profileStore() (*profile.Store, error) {
	if a.profileStoreError != nil {
		return nil, fmt.Errorf("locate profile store: %w", a.profileStoreError)
	}
	if a.profiles == nil {
		return nil, fmt.Errorf("profile store is unavailable")
	}
	return a.profiles, nil
}

func (a *App) profileByID(id string) (profile.Profile, error) {
	drafts, err := a.Profiles()
	if err != nil {
		return profile.Profile{}, err
	}
	for _, draft := range drafts {
		if draft.ID == id {
			return draft, nil
		}
	}
	return profile.Profile{}, fmt.Errorf("profile %q does not exist", id)
}

// ManagerStatus performs the mandatory hello/capability negotiation. It does
// not access hardware and intentionally treats an unsupported manager.get as
// API-incomplete rather than enabling manager-dependent UI optimistically.
func (a *App) ManagerStatus() managerapi.ConnectionStatus {
	return a.manager.StatusWithTimeout(2 * time.Second)
}

// Workspace loads only capability-advertised normal application data. In the
// reviewed manager revision manager.get is unavailable, so it returns an
// API-incomplete state and no device calls are made.
func (a *App) Workspace() managerapi.Workspace {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	workspace := a.loadWorkspace(ctx)
	a.observeWorkspace(workspace)
	return workspace
}

func (a *App) loadWorkspace(ctx context.Context) managerapi.Workspace {
	// A snapshot is a point-in-time authority. Serializing requests prevents a
	// slow earlier request from overwriting a newer snapshot/event cursor.
	a.workspaceLoadMu.Lock()
	defer a.workspaceLoadMu.Unlock()
	return a.recordWorkspace(a.manager.LoadWorkspace(ctx))
}

// recordWorkspace retains the last authoritative snapshot only as explicitly
// stale context. It never relabels cached health as live after the manager call
// fails or loses a capability.
func (a *App) recordWorkspace(workspace managerapi.Workspace) managerapi.Workspace {
	a.workspaceMu.Lock()
	defer a.workspaceMu.Unlock()
	if workspace.Snapshot != nil {
		workspace.Stale = false
		copy := workspace
		a.lastWorkspace = &copy
		a.persistEventCursor(workspace.Snapshot.EventCursor)
		return workspace
	}
	if a.lastWorkspace == nil || a.lastWorkspace.Snapshot == nil {
		return workspace
	}
	last := a.lastWorkspace
	workspace.Snapshot = last.Snapshot
	workspace.Stale = true
	workspace.SnapshotAt = last.SnapshotAt
	// Capability metadata describes whether the retained inventory can be
	// displayed. Runtime actions remain disabled because Status is not ready.
	if len(workspace.Status.Capabilities) == 0 {
		workspace.Status.Capabilities = last.Status.Capabilities
	}
	if workspace.Status.ServerID == "" {
		workspace.Status.ServerID = last.Status.ServerID
	}
	if workspace.Status.Version == "" {
		workspace.Status.Version = last.Status.Version
	}
	return workspace
}

func (a *App) persistEventCursor(cursor managerapi.EventCursor) {
	if a.eventCursors == nil {
		return
	}
	// Loss of this optional convenience state never affects the authoritative
	// snapshot or event subscription. A later snapshot remains the recovery path.
	_ = a.eventCursors.Save(cursor)
}

func (a *App) staleWorkspace(message string) (managerapi.Workspace, bool) {
	a.workspaceMu.Lock()
	defer a.workspaceMu.Unlock()
	if a.lastWorkspace == nil || a.lastWorkspace.Snapshot == nil {
		return managerapi.Workspace{}, false
	}
	stale := *a.lastWorkspace
	stale.Stale = true
	stale.Status.State = "reconnecting"
	stale.Status.Message = message
	return stale, true
}

// observeWorkspace maintains one dedicated event-stream connection. Events are
// hints, not source of truth: every burst is coalesced into a fresh snapshot.
func (a *App) observeWorkspace(workspace managerapi.Workspace) {
	a.monitorMu.Lock()
	if a.shuttingDown {
		a.monitorMu.Unlock()
		return
	}
	if a.monitorGeneration == 0 {
		a.monitorGeneration++
	}
	generation := a.monitorGeneration
	if !workspaceEventStreamAvailable(workspace) {
		previous := a.monitor
		a.monitor = nil
		if previous != nil {
			a.monitorGeneration++
			generation = a.monitorGeneration
		}
		a.monitorMu.Unlock()
		if previous != nil {
			_ = previous.Close()
		}
		delay := workspaceRefreshInterval
		if workspace.Snapshot == nil || workspace.Stale {
			delay = workspaceRetryInterval
		}
		a.scheduleWorkspaceResync(generation, delay)
		return
	}
	cursor := a.subscriptionCursor(workspace.Snapshot.EventCursor)
	if a.ctx == nil || (a.monitor != nil && a.monitor.Info.ServerID == cursor.ServerID) {
		a.monitorMu.Unlock()
		return
	}
	previous := a.monitor
	a.monitor = nil
	a.monitorGeneration++
	generation = a.monitorGeneration
	a.monitorMu.Unlock()
	if previous != nil {
		_ = previous.Close()
	}
	go a.openWorkspaceMonitor(generation, cursor)
}

func workspaceEventStreamAvailable(workspace managerapi.Workspace) bool {
	if workspace.Stale || workspace.Status.State != "ready" || workspace.Snapshot == nil {
		return false
	}
	available, _ := managerapi.CapabilityAvailable(workspace.Status.Capabilities, "event_stream")
	return available
}

// subscriptionCursor makes the persisted cursor part of the restart handoff
// without ever skipping ahead of the fresh snapshot. A persisted cursor only
// replaces an identical snapshot boundary; otherwise the snapshot is newer (or
// belongs to a restarted manager) and is the only safe replay starting point.
func (a *App) subscriptionCursor(snapshot managerapi.EventCursor) managerapi.EventCursor {
	if a.eventCursors == nil || snapshot.ServerID == "" {
		return snapshot
	}
	persisted, err := a.eventCursors.Load()
	if err != nil || persisted.ServerID != snapshot.ServerID || persisted.EventID != snapshot.EventID || persisted.StateRevision != snapshot.StateRevision {
		return snapshot
	}
	return persisted
}

func (a *App) openWorkspaceMonitor(generation uint64, cursor managerapi.EventCursor) {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	monitor, err := a.manager.Subscribe(ctx, cursor)
	if err != nil {
		a.scheduleWorkspaceResync(generation, workspaceRetryInterval)
		return
	}
	a.monitorMu.Lock()
	if a.shuttingDown || generation != a.monitorGeneration {
		a.monitorMu.Unlock()
		_ = monitor.Close()
		return
	}
	a.monitor = monitor
	a.monitorMu.Unlock()
	a.runWorkspaceMonitor(generation, monitor)
}

func (a *App) runWorkspaceMonitor(generation uint64, monitor *managerapi.EventSubscription) {
	var refresh <-chan time.Time
	var timer *time.Timer
	for {
		select {
		case <-monitor.Done():
			if timer != nil {
				timer.Stop()
			}
			if !a.clearWorkspaceMonitor(generation, monitor) {
				return
			}
			a.persistEventCursor(monitor.Cursor())
			if stale, ok := a.staleWorkspace("The manager event stream disconnected. Refreshing the authoritative keyboard snapshot…"); ok {
				a.emitWorkspace(stale)
			}
			a.scheduleWorkspaceResync(generation, 250*time.Millisecond)
			return
		case _, open := <-monitor.Events:
			if !open {
				if timer != nil {
					timer.Stop()
				}
				if !a.clearWorkspaceMonitor(generation, monitor) {
					return
				}
				a.persistEventCursor(monitor.Cursor())
				if stale, ok := a.staleWorkspace("The manager event stream disconnected. Refreshing the authoritative keyboard snapshot…"); ok {
					a.emitWorkspace(stale)
				}
				a.scheduleWorkspaceResync(generation, 250*time.Millisecond)
				return
			}
			// Event types are intentionally opaque hints. A future event still
			// advances the cursor and triggers a complete authoritative snapshot.
			a.persistEventCursor(monitor.Cursor())
			if timer == nil {
				timer = time.NewTimer(150 * time.Millisecond)
				refresh = timer.C
			}
		case <-refresh:
			timer = nil
			refresh = nil
			a.refreshWorkspace(generation)
		}
	}
}

func (a *App) clearWorkspaceMonitor(generation uint64, monitor *managerapi.EventSubscription) bool {
	a.monitorMu.Lock()
	defer a.monitorMu.Unlock()
	if generation == a.monitorGeneration && a.monitor == monitor {
		a.monitor = nil
		return true
	}
	return false
}

func (a *App) scheduleWorkspaceResync(generation uint64, delay time.Duration) {
	if delay <= 0 {
		delay = workspaceRetryInterval
	}
	due := time.Now().Add(delay)
	a.monitorMu.Lock()
	if a.shuttingDown || generation != a.monitorGeneration {
		a.monitorMu.Unlock()
		return
	}
	if a.refreshTimer != nil && !a.refreshDue.After(due) {
		a.monitorMu.Unlock()
		return
	}
	if a.refreshTimer != nil {
		a.refreshTimer.Stop()
	}
	timer := time.NewTimer(delay)
	a.refreshTimer = timer
	a.refreshDue = due
	a.monitorMu.Unlock()
	go func() {
		<-timer.C
		a.monitorMu.Lock()
		if a.refreshTimer != timer {
			a.monitorMu.Unlock()
			return
		}
		a.refreshTimer = nil
		a.refreshDue = time.Time{}
		a.monitorMu.Unlock()
		a.refreshWorkspace(generation)
	}()
}

func (a *App) refreshWorkspace(generation uint64) {
	a.monitorMu.Lock()
	current := !a.shuttingDown && generation == a.monitorGeneration
	a.monitorMu.Unlock()
	if !current {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	workspace := a.loadWorkspace(ctx)
	a.emitWorkspace(workspace)
	a.observeWorkspace(workspace)
}

func (a *App) emitWorkspace(workspace managerapi.Workspace) {
	if a.ctx != nil {
		runtime.EventsEmit(a.ctx, "workspace:changed", workspace)
	}
}

func (a *App) canUse(ctx context.Context, capability string) error {
	info, err := a.manager.ManagerGet(ctx)
	if err != nil {
		return err
	}
	available, reason := managerapi.CapabilityAvailable(info.Capabilities, capability)
	if !available {
		return &managerapi.Error{Code: "unsupported_capability", Message: reason}
	}
	return nil
}

func (a *App) IdentifyStart(deviceID string, timeoutMS int) (managerapi.Operation, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := a.canUse(ctx, "device_identification"); err != nil {
		return managerapi.Operation{}, err
	}
	return a.manager.IdentifyStart(ctx, managerapi.IdentifyStartParams{DeviceID: deviceID, TimeoutMS: timeoutMS})
}
func (a *App) IdentifyCancel(operationID string) (managerapi.Operation, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := a.canUse(ctx, "device_identification"); err != nil {
		return managerapi.Operation{}, err
	}
	return a.manager.IdentifyCancel(ctx, operationID)
}
func (a *App) IdentifyOperation(operationID string) (managerapi.Operation, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := a.canUse(ctx, "device_identification"); err != nil {
		return managerapi.Operation{}, err
	}
	return a.manager.OperationGet(ctx, operationID)
}

// The following bindings support explicitly labelled integration development.
// They do not replace normal capability-gated application flows.
func (a *App) IntegrationDeviceList() (managerapi.DeviceListResult, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return a.manager.DeviceList(ctx)
}
func (a *App) IntegrationIdentifyStart(deviceID string, timeoutMS int) (managerapi.Operation, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return a.manager.IdentifyStart(ctx, managerapi.IdentifyStartParams{DeviceID: deviceID, TimeoutMS: timeoutMS})
}
func (a *App) IntegrationIdentifyCancel(operationID string) (managerapi.Operation, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return a.manager.IdentifyCancel(ctx, operationID)
}
func (a *App) IntegrationOperationGet(operationID string) (managerapi.Operation, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return a.manager.OperationGet(ctx, operationID)
}
func (a *App) IntegrationPreview(deviceID, behavior string) (managerapi.PreviewResult, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return a.manager.Preview(ctx, managerapi.PreviewParams{Model: &managerapi.PreviewModel{DeviceID: deviceID, Behavior: behavior}})
}
