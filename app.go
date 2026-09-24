package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
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
	ProfileID       string                      `json:"profile_id"`
	DraftRevision   uint64                      `json:"draft_revision"`
	DeviceID        string                      `json:"device_id"`
	ManagerServerID string                      `json:"manager_server_id"`
	StateRevision   uint64                      `json:"state_revision"`
	Validation      managerapi.ValidationResult `json:"validation"`
	SourceMap       []compiler.SourceMapEntry   `json:"source_map"`
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
	return ProfilePreview{ProfileID: draft.ID, DraftRevision: draft.DraftRevision, DeviceID: draft.DeviceID, ManagerServerID: after.ServerID, StateRevision: after.StateRevision, Validation: preview.Validation, SourceMap: compiled.SourceMap}, nil
}

// ProfileApplyResult links the accepted manager operation to the local draft.
// The operation is terminal when returned by the reviewed manager, but the UI
// still displays its manager-owned lifecycle outcome rather than assuming that
// a successful validation means activation.
type ProfileApplyResult struct {
	Profile   profile.Profile      `json:"profile"`
	Operation managerapi.Operation `json:"operation"`
}

// ApplyProfile creates or updates the manager-owned configuration associated
// with this local profile. It never accesses a device or writes a .kbd file.
// In particular, a transport failure after dispatch remains recorded locally:
// retrying a mutation without manager-side idempotency could duplicate it.
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
	pending, err := store.SetApplyState(draft.ID, draft.DraftRevision, "", &profile.PendingApply{ManagerServerID: info.ServerID, StartedAt: time.Now().UTC()})
	if err != nil {
		return ProfileApplyResult{}, err
	}
	params := managerapi.ConfigurationWriteParams{
		ConfigurationID:  configurationID,
		Name:             pending.Name,
		Model:            managerapi.PreviewModel{DeviceID: pending.DeviceID, Behavior: compiled.Behavior},
		ExpectedRevision: expected,
	}
	var operation managerapi.Operation
	if configurationID == "" {
		operation, err = a.manager.ConfigurationCreate(ctx, params)
	} else {
		operation, err = a.manager.ConfigurationUpdate(ctx, params)
	}
	if err != nil {
		var managerError *managerapi.Error
		if errors.As(err, &managerError) && managerError.Code != "transport" {
			if _, saveErr := store.SetApplyState(pending.ID, pending.DraftRevision, "", nil); saveErr != nil {
				return ProfileApplyResult{}, fmt.Errorf("apply was rejected (%w); also could not clear the local pending state: %v", err, saveErr)
			}
		}
		return ProfileApplyResult{}, err
	}
	// A rejected create is never persisted by the manager. Successful,
	// rolled-back, and failed lifecycle outcomes still identify a managed
	// resource, so retain the opaque ID for a revision-checked next update.
	linkedID := ""
	if operation.State != "rejected" && operation.Resource != nil && operation.Resource.Kind == "configuration" && operation.Resource.ID != "" {
		linkedID = operation.Resource.ID
	}
	linked, saveErr := store.SetApplyState(pending.ID, pending.DraftRevision, linkedID, nil)
	if saveErr != nil {
		return ProfileApplyResult{}, fmt.Errorf("manager apply completed but KeyboarDeer could not save its configuration link: %w", saveErr)
	}
	return ProfileApplyResult{Profile: linked, Operation: operation}, nil
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
		return a.manager.ConfigurationSetEnabled(ctx, managerapi.ConfigurationSetEnabledParams{
			ConfigurationID:  configuration.ID,
			ExpectedRevision: configuration.DesiredRevision,
			Enabled:          enabled,
		})
	}
	return managerapi.Operation{}, fmt.Errorf("manager configuration %q does not exist", configurationID)
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
		operation, err := a.manager.ConfigurationDelete(ctx, managerapi.ConfigurationDeleteParams{
			ConfigurationID:  configuration.ID,
			ExpectedRevision: configuration.DesiredRevision,
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
