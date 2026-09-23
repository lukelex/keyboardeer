package main

import "context"

const appVersion = "0.1.0-dev"

// App is deliberately small: platform input and KMonad process management
// belong to kmonad-device-manager, not the desktop application.
type App struct {
	ctx context.Context
}

type AppInfo struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

func (a *App) shutdown(context.Context) {}

// Info gives the frontend a stable, side-effect-free binding while the manager
// bridge is introduced in the next milestone.
func (a *App) Info() AppInfo {
	return AppInfo{Name: "KeyboarDeer", Version: appVersion}
}
