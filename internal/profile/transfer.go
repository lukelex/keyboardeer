package profile

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
)

const TransferVersion = 1

// Transfer is a portable behavior-only profile. It intentionally excludes the
// machine-specific device ID, manager links, pending operations, and timestamps.
// It is not a KMonad configuration and cannot be applied directly.
type Transfer struct {
	Format      string                `json:"format"`
	Version     int                   `json:"version"`
	Name        string                `json:"name"`
	Geometry    Geometry              `json:"geometry"`
	Layers      []Layer               `json:"layers"`
	Assignments []Assignment          `json:"assignments"`
	Aliases     map[string]Behavior   `json:"aliases,omitempty"`
	Macros      map[string][]Behavior `json:"macros,omitempty"`
	Settings    CompilerSettings      `json:"settings"`
}

func Export(profile Profile) ([]byte, error) {
	if err := Validate(profile); err != nil {
		return nil, fmt.Errorf("cannot export invalid profile: %w", err)
	}
	transfer := Transfer{
		Format: "keyboardeer-profile", Version: TransferVersion, Name: profile.Name,
		Geometry: profile.Geometry, Layers: profile.Layers, Assignments: profile.Assignments,
		Aliases: profile.Aliases, Macros: profile.Macros, Settings: profile.Settings,
	}
	data, err := json.MarshalIndent(transfer, "", "  ")
	if err != nil {
		return nil, err
	}
	return append(data, '\n'), nil
}

func Import(data []byte, deviceID string) (Profile, error) {
	if len(data) == 0 || len(data) > 4<<20 {
		return Profile{}, fmt.Errorf("profile file must be between 1 byte and 4 MiB")
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	var transfer Transfer
	if err := decoder.Decode(&transfer); err != nil {
		return Profile{}, fmt.Errorf("read profile file: %w", err)
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return Profile{}, fmt.Errorf("profile file contains trailing data")
	}
	if transfer.Format != "keyboardeer-profile" || transfer.Version != TransferVersion {
		return Profile{}, fmt.Errorf("unsupported profile format or version")
	}
	profile, err := New(deviceID, transfer.Name, transfer.Geometry)
	if err != nil {
		return Profile{}, err
	}
	profile.Layers = transfer.Layers
	profile.Assignments = transfer.Assignments
	profile.Aliases = transfer.Aliases
	profile.Macros = transfer.Macros
	profile.Settings = transfer.Settings
	if profile.Aliases == nil {
		profile.Aliases = map[string]Behavior{}
	}
	if profile.Macros == nil {
		profile.Macros = map[string][]Behavior{}
	}
	if err := Validate(profile); err != nil {
		return Profile{}, fmt.Errorf("invalid profile file: %w", err)
	}
	return profile, nil
}
