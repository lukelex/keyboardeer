package main

import (
	"context"
	"time"

	"github.com/lukelex/keyboardeer/internal/managerapi"
)

const appVersion = "0.1.0-dev"

// App is deliberately small: platform input and KMonad process management
// belong to kmonad-device-manager, not the desktop application.
type App struct {
	ctx     context.Context
	manager *managerapi.APIClient
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
	return a.manager.LoadWorkspace(ctx)
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
