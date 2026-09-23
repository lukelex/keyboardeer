// Package profile owns KeyboarDeer's editable keyboard model. Manager API
// objects are references only; generated KMonad text is never profile state.
package profile

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"
	"time"
)

const StoreVersion = 1

type StoreData struct {
	Version  int       `json:"version"`
	Profiles []Profile `json:"profiles"`
}

type Profile struct {
	ID                     string                `json:"id"`
	Name                   string                `json:"name"`
	DeviceID               string                `json:"device_id"`
	ManagerConfigurationID string                `json:"manager_configuration_id,omitempty"`
	DraftRevision          uint64                `json:"draft_revision"`
	Geometry               Geometry              `json:"geometry"`
	Layers                 []Layer               `json:"layers"`
	Assignments            []Assignment          `json:"assignments"`
	Aliases                map[string]Behavior   `json:"aliases,omitempty"`
	Macros                 map[string][]Behavior `json:"macros,omitempty"`
	Settings               CompilerSettings      `json:"settings"`
	CreatedAt              time.Time             `json:"created_at"`
	UpdatedAt              time.Time             `json:"updated_at"`
}

type Geometry struct {
	ID         string   `json:"id"`
	SourceKeys []string `json:"source_keys"`
}

type Layer struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type Assignment struct {
	LayerID   string   `json:"layer_id"`
	SourceKey string   `json:"source_key"`
	Behavior  Behavior `json:"behavior"`
}

type Behavior struct {
	Kind      string    `json:"kind"`
	Key       string    `json:"key,omitempty"`
	Target    string    `json:"target,omitempty"`
	Tap       *Behavior `json:"tap,omitempty"`
	Hold      *Behavior `json:"hold,omitempty"`
	TimeoutMS int       `json:"timeout_ms,omitempty"`
}

type CompilerSettings struct {
	Version int `json:"version"`
}

func NewID() (string, error) {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return "profile_" + hex.EncodeToString(bytes), nil
}

func New(deviceID, name string, geometry Geometry) (Profile, error) {
	id, err := NewID()
	if err != nil {
		return Profile{}, fmt.Errorf("create profile ID: %w", err)
	}
	now := time.Now().UTC()
	profile := Profile{ID: id, Name: name, DeviceID: deviceID, Geometry: geometry,
		Layers: []Layer{{ID: "base", Name: "Base"}}, Aliases: map[string]Behavior{}, Macros: map[string][]Behavior{},
		Settings: CompilerSettings{Version: 1}, DraftRevision: 1, CreatedAt: now, UpdatedAt: now}
	return profile, Validate(profile)
}

func ValidateStore(data StoreData) error {
	if data.Version != StoreVersion {
		return fmt.Errorf("unsupported profile store version %d", data.Version)
	}
	ids := map[string]bool{}
	for _, profile := range data.Profiles {
		if ids[profile.ID] {
			return fmt.Errorf("duplicate profile ID %q", profile.ID)
		}
		ids[profile.ID] = true
		if err := Validate(profile); err != nil {
			return fmt.Errorf("profile %q: %w", profile.ID, err)
		}
	}
	return nil
}

func Validate(profile Profile) error {
	if profile.ID == "" || profile.DeviceID == "" || strings.TrimSpace(profile.Name) == "" {
		return fmt.Errorf("profile ID, device ID, and name are required")
	}
	if profile.Settings.Version != 1 {
		return fmt.Errorf("unsupported compiler settings version %d", profile.Settings.Version)
	}
	if profile.DraftRevision == 0 {
		return fmt.Errorf("draft revision must be positive")
	}
	if profile.Geometry.ID == "" || len(profile.Geometry.SourceKeys) == 0 {
		return fmt.Errorf("a verified geometry and source keys are required")
	}
	sources, layers := map[string]bool{}, map[string]bool{}
	for _, key := range profile.Geometry.SourceKeys {
		if key == "" || sources[key] {
			return fmt.Errorf("geometry has an invalid or duplicate source key")
		}
		sources[key] = true
	}
	for _, layer := range profile.Layers {
		if layer.ID == "" || strings.TrimSpace(layer.Name) == "" || layers[layer.ID] {
			return fmt.Errorf("layers need unique IDs and names")
		}
		layers[layer.ID] = true
	}
	if !layers["base"] {
		return fmt.Errorf("a base layer is required")
	}
	assigned := map[string]bool{}
	for _, assignment := range profile.Assignments {
		if !layers[assignment.LayerID] || !sources[assignment.SourceKey] {
			return fmt.Errorf("assignment references an unknown layer or source key")
		}
		address := assignment.LayerID + "\x00" + assignment.SourceKey
		if assigned[address] {
			return fmt.Errorf("duplicate assignment")
		}
		assigned[address] = true
		if err := validateBehavior(assignment.Behavior, layers, profile.Aliases, profile.Macros); err != nil {
			return err
		}
	}
	for name, behavior := range profile.Aliases {
		if name == "" {
			return fmt.Errorf("alias has an empty name")
		}
		if err := validateBehavior(behavior, layers, profile.Aliases, profile.Macros); err != nil {
			return fmt.Errorf("alias %q: %w", name, err)
		}
	}
	for name, macro := range profile.Macros {
		if name == "" || len(macro) == 0 {
			return fmt.Errorf("macro has an empty name or body")
		}
		if _, exists := profile.Aliases[name]; exists {
			return fmt.Errorf("alias and macro share the name %q", name)
		}
		for _, behavior := range macro {
			if err := validateBehavior(behavior, layers, profile.Aliases, profile.Macros); err != nil {
				return fmt.Errorf("macro %q: %w", name, err)
			}
		}
	}
	return nil
}
func validateBehavior(b Behavior, layers map[string]bool, aliases map[string]Behavior, macros map[string][]Behavior) error {
	switch b.Kind {
	case "key":
		if b.Key == "" {
			return fmt.Errorf("key behavior needs a key")
		}
	case "transparent", "disabled":
	case "hold_layer", "switch_layer":
		if !layers[b.Target] {
			return fmt.Errorf("layer behavior targets an unknown layer")
		}
	case "alias":
		if _, ok := aliases[b.Target]; !ok {
			return fmt.Errorf("behavior targets an unknown alias")
		}
	case "macro":
		if _, ok := macros[b.Target]; !ok {
			return fmt.Errorf("behavior targets an unknown macro")
		}
	case "tap_hold":
		if b.Tap == nil || b.Hold == nil || b.TimeoutMS <= 0 {
			return fmt.Errorf("tap/hold behavior needs tap, hold, and positive timeout")
		}
		if err := validateBehavior(*b.Tap, layers, aliases, macros); err != nil {
			return err
		}
		return validateBehavior(*b.Hold, layers, aliases, macros)
	default:
		return fmt.Errorf("unknown behavior kind %q", b.Kind)
	}
	return nil
}

func CanonicalAssignments(assignments []Assignment) []Assignment {
	result := append([]Assignment(nil), assignments...)
	sort.Slice(result, func(i, j int) bool {
		if result[i].LayerID == result[j].LayerID {
			return result[i].SourceKey < result[j].SourceKey
		}
		return result[i].LayerID < result[j].LayerID
	})
	return result
}
