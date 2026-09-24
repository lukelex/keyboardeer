package main

import (
	"encoding/json"
	"os"
	"path/filepath"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type windowState struct {
	X      int `json:"x"`
	Y      int `json:"y"`
	Width  int `json:"width"`
	Height int `json:"height"`
}

func windowStatePath() (string, error) {
	config, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(config, "keyboardeer", "window.json"), nil
}

func (a *App) restoreWindowState() {
	if a.ctx == nil {
		return
	}
	path, err := windowStatePath()
	if err != nil {
		return
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return
	}
	var state windowState
	if json.Unmarshal(data, &state) != nil || state.Width < 760 || state.Height < 600 || state.Width > 10000 || state.Height > 10000 || state.X < -10000 || state.X > 10000 || state.Y < -10000 || state.Y > 10000 {
		return
	}
	runtime.WindowSetSize(a.ctx, state.Width, state.Height)
	runtime.WindowSetPosition(a.ctx, state.X, state.Y)
}

func (a *App) saveWindowState() {
	if a.ctx == nil {
		return
	}
	width, height := runtime.WindowGetSize(a.ctx)
	if width < 760 || height < 600 {
		return
	}
	x, y := runtime.WindowGetPosition(a.ctx)
	path, err := windowStatePath()
	if err != nil {
		return
	}
	data, err := json.Marshal(windowState{X: x, Y: y, Width: width, Height: height})
	if err != nil {
		return
	}
	if os.MkdirAll(filepath.Dir(path), 0o700) != nil {
		return
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".window-*")
	if err != nil {
		return
	}
	name := temporary.Name()
	defer os.Remove(name)
	if err = temporary.Chmod(0o600); err == nil {
		_, err = temporary.Write(append(data, '\n'))
	}
	if err == nil {
		err = temporary.Sync()
	}
	if closeErr := temporary.Close(); err == nil {
		err = closeErr
	}
	if err == nil {
		_ = os.Rename(name, path)
	}
}
