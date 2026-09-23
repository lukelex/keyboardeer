package main

import (
	"context"
	"sync"
	"time"

	"github.com/lukelex/keyboardeer/internal/managerapi"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

const appVersion = "0.1.0-dev"

// App is deliberately small: platform input and KMonad process management
// belong to kmonad-device-manager, not the desktop application.
type App struct {
	ctx               context.Context
	manager           *managerapi.APIClient
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
	return &App{manager: managerapi.New(managerapi.Options{
		ClientName:    "keyboardeer",
		ClientVersion: appVersion,
	})}
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
