package main

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/lukelex/keyboardeer/internal/compiler"
	"github.com/lukelex/keyboardeer/internal/geometry"
	"github.com/lukelex/keyboardeer/internal/managerapi"
	"github.com/lukelex/keyboardeer/internal/profile"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

const appVersion = "0.1.0-dev"

// App is deliberately small: platform input and KMonad process management
// belong to kmonad-device-manager, not the desktop application.
type App struct {
	ctx               context.Context
	manager           *managerapi.APIClient
	profiles          *profile.Store
	profileStoreError error
	monitorMu         sync.Mutex
	monitor           *managerapi.EventSubscription
	monitorGeneration uint64
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
	}
	return app
}

func newAppWithProfileStore(store *profile.Store) *App {
	return &App{manager: managerapi.New(managerapi.Options{ClientName: "keyboardeer", ClientVersion: appVersion}), profiles: store}
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
	a.monitorMu.Unlock()
	if monitor != nil {
		_ = monitor.Close()
	}
	_ = a.manager.Close()
}

// Info gives the frontend a stable, side-effect-free binding.
func (a *App) Info() AppInfo {
	return AppInfo{Name: "KeyboarDeer", Version: appVersion}
}

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
	drafts, err := a.Profiles()
	if err != nil {
		return compiler.Result{}, err
	}
	for _, draft := range drafts {
		if draft.ID == id {
			return compiler.Compile(draft)
		}
	}
	return compiler.Result{}, fmt.Errorf("profile %q does not exist", id)
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
	workspace := a.manager.LoadWorkspace(ctx)
	a.observeWorkspace(workspace)
	return workspace
}

// observeWorkspace maintains one dedicated event-stream connection. Events are
// hints, not source of truth: every burst is coalesced into a fresh snapshot.
func (a *App) observeWorkspace(workspace managerapi.Workspace) {
	if workspace.Snapshot == nil || a.ctx == nil {
		return
	}
	cursor := workspace.Snapshot.EventCursor
	a.monitorMu.Lock()
	if a.shuttingDown || (a.monitor != nil && a.monitor.Info.ServerID == cursor.ServerID) {
		a.monitorMu.Unlock()
		return
	}
	previous := a.monitor
	a.monitor = nil
	a.monitorGeneration++
	generation := a.monitorGeneration
	a.monitorMu.Unlock()
	if previous != nil {
		_ = previous.Close()
	}
	go a.openWorkspaceMonitor(generation, cursor)
}

func (a *App) openWorkspaceMonitor(generation uint64, cursor managerapi.EventCursor) {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	monitor, err := a.manager.Subscribe(ctx, cursor)
	if err != nil {
		a.scheduleWorkspaceResync(generation, time.Second)
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
		case _, open := <-monitor.Events:
			if !open {
				if timer != nil {
					timer.Stop()
				}
				a.clearWorkspaceMonitor(generation, monitor)
				a.scheduleWorkspaceResync(generation, 250*time.Millisecond)
				return
			}
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

func (a *App) clearWorkspaceMonitor(generation uint64, monitor *managerapi.EventSubscription) {
	a.monitorMu.Lock()
	defer a.monitorMu.Unlock()
	if generation == a.monitorGeneration && a.monitor == monitor {
		a.monitor = nil
	}
}

func (a *App) scheduleWorkspaceResync(generation uint64, delay time.Duration) {
	go func() {
		time.Sleep(delay)
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
	workspace := a.manager.LoadWorkspace(ctx)
	a.emitWorkspace(workspace)
	if workspace.Snapshot != nil {
		a.observeWorkspace(workspace)
		return
	}
	a.scheduleWorkspaceResync(generation, time.Second)
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
