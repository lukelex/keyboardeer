// Package profile owns KeyboarDeer's editable keyboard model. Manager API
// objects are references only; generated KMonad text is never profile state.
package profile

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"
)

const StoreVersion = 3

// maxNameLength bounds user-visible names. Longer names cannot be displayed
// usefully and are rejected rather than silently truncated.
const maxNameLength = 80

// identifier is the portable form for layer IDs and alias/macro names, which
// are emitted verbatim as KMonad identifiers.
var identifier = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9-]*$`)

type StoreData struct {
	Version  int       `json:"version"`
	Profiles []Profile `json:"profiles"`
	// Selected maps a manager device ID to the profile opened for that
	// keyboard. A keyboard may have several profiles; one is selected.
	Selected map[string]string `json:"selected,omitempty"`
}

type Profile struct {
	ID                     string                `json:"id"`
	Name                   string                `json:"name"`
	DeviceID               string                `json:"device_id"`
	ManagerConfigurationID string                `json:"manager_configuration_id,omitempty"`
	ApplyPending           *PendingApply         `json:"apply_pending,omitempty"`
	LastApplyOperation     *ApplyOutcome         `json:"last_apply_operation,omitempty"`
	DraftRevision          uint64                `json:"draft_revision"`
	Geometry               Geometry              `json:"geometry"`
	Layers                 []Layer               `json:"layers"`
	Assignments            []Assignment          `json:"assignments"`
	Aliases                map[string]Behavior   `json:"aliases,omitempty"`
	Macros                 map[string][]Behavior `json:"macros,omitempty"`
	Settings               CompilerSettings      `json:"settings"`
	ValidationRecovery     *ValidationRecovery   `json:"validation_recovery,omitempty"`
	CreatedAt              time.Time             `json:"created_at"`
	UpdatedAt              time.Time             `json:"updated_at"`
}

// ValidationRecovery is local draft provenance. It never changes manager
// configuration state and is intentionally separate from apply/runtime
// rollback metadata.
type ValidationRecovery struct {
	Checkpoint *ValidationCheckpoint `json:"checkpoint,omitempty"`
	PreEdit    []AssignmentFallback  `json:"pre_edit,omitempty"`
}

type ValidationCheckpoint struct {
	DraftRevision   uint64                `json:"draft_revision"`
	ManagerServerID string                `json:"manager_server_id"`
	CandidateDigest string                `json:"candidate_digest"`
	Geometry        Geometry              `json:"geometry"`
	Layers          []Layer               `json:"layers"`
	Assignments     []Assignment          `json:"assignments"`
	Aliases         map[string]Behavior   `json:"aliases,omitempty"`
	Macros          map[string][]Behavior `json:"macros,omitempty"`
}

// AssignmentFallback records only the pre-edit value for one assignment. A
// false HadAssignment means the safe inverse is to remove the current override.
type AssignmentFallback struct {
	GeometryID    string   `json:"geometry_id"`
	LayerID       string   `json:"layer_id"`
	SourceKey     string   `json:"source_key"`
	HadAssignment bool     `json:"had_assignment"`
	Behavior      Behavior `json:"behavior,omitempty"`
}

// PendingApply is written before a manager mutation is sent. It records the
// exact request and its idempotency key. A lost response is safe to replay only
// when the manager version guarantees durable idempotency.
// Accepted operations with a known ID are followed directly on every version.
type PendingApply struct {
	ManagerServerID      string          `json:"manager_server_id"`
	StartedAt            time.Time       `json:"started_at"`
	IdempotencyKey       string          `json:"idempotency_key,omitempty"`
	IdempotencySupported bool            `json:"idempotency_supported,omitempty"`
	Method               string          `json:"method,omitempty"`
	Request              json.RawMessage `json:"request,omitempty"`
	OperationID          string          `json:"operation_id,omitempty"`
}

// ApplyOutcome is the durable, manager-reported result of the latest apply
// initiated from this profile. Runtime state and the actually active revision
// remain authoritative in the manager workspace snapshot.
type ApplyOutcome struct {
	ID                    string         `json:"id"`
	Kind                  string         `json:"kind"`
	State                 string         `json:"state"`
	Resource              *ApplyResource `json:"resource,omitempty"`
	StartedAt             string         `json:"started_at,omitempty"`
	UpdatedAt             string         `json:"updated_at,omitempty"`
	ReasonCode            string         `json:"reason_code"`
	Reason                string         `json:"reason"`
	ConfigurationRevision uint64         `json:"configuration_revision,omitempty"`
}

type ApplyResource struct {
	Kind string `json:"kind"`
	ID   string `json:"id"`
}

// Replayable reports whether the pending apply can be recovered safely.
func (p PendingApply) Replayable() bool {
	return p.IdempotencySupported && p.HasReplayableRequest()
}

// HasReplayableRequest reports whether the exact mutation is retained, even
// when its original manager version did not guarantee idempotency.
func (p PendingApply) HasReplayableRequest() bool {
	return p.IdempotencyKey != "" && len(p.Request) != 0 &&
		(p.Method == "configuration.create" || p.Method == "configuration.update")
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
	devices := map[string]string{}
	links := map[string]string{}
	for _, profile := range data.Profiles {
		if _, exists := devices[profile.ID]; exists {
			return fmt.Errorf("duplicate profile ID %q", profile.ID)
		}
		devices[profile.ID] = profile.DeviceID
		if err := Validate(profile); err != nil {
			return fmt.Errorf("profile %q: %w", profile.ID, err)
		}
		// One manager configuration represents one profile at a time; Apply
		// moves the link when a keyboard switches profiles.
		if id := profile.ManagerConfigurationID; id != "" {
			if other, exists := links[id]; exists {
				return fmt.Errorf("profiles %q and %q link the same manager configuration", other, profile.ID)
			}
			links[id] = profile.ID
		}
	}
	for deviceID, profileID := range data.Selected {
		if owner, exists := devices[profileID]; !exists || owner != deviceID {
			return fmt.Errorf("selected profile %q is not a profile for device %q", profileID, deviceID)
		}
	}
	return nil
}

// ProfilesForDevice returns a keyboard's profiles in creation order.
func (data StoreData) ProfilesForDevice(deviceID string) []Profile {
	result := []Profile{}
	for _, profile := range data.Profiles {
		if profile.DeviceID == deviceID {
			result = append(result, profile)
		}
	}
	sort.SliceStable(result, func(i, j int) bool { return result[i].CreatedAt.Before(result[j].CreatedAt) })
	return result
}

func Validate(profile Profile) error {
	if profile.ID == "" || profile.DeviceID == "" || strings.TrimSpace(profile.Name) == "" {
		return fmt.Errorf("profile ID, device ID, and name are required")
	}
	if len([]rune(profile.Name)) > maxNameLength {
		return fmt.Errorf("profile name is longer than %d characters", maxNameLength)
	}
	if pending := profile.ApplyPending; pending != nil {
		if pending.ManagerServerID == "" || pending.StartedAt.IsZero() {
			return fmt.Errorf("pending apply is incomplete")
		}
		if (pending.IdempotencyKey != "" || pending.IdempotencySupported) && !pending.HasReplayableRequest() {
			return fmt.Errorf("pending apply has an idempotency key but no complete request")
		}
	}
	if outcome := profile.LastApplyOperation; outcome != nil && (outcome.State == "" || (outcome.ID == "" && outcome.State != "unknown")) {
		return fmt.Errorf("last apply operation is incomplete")
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
		if key == "" {
			return fmt.Errorf("geometry has an invalid source key")
		}
		// Multiple physical positions can emit the same KMonad input code (for
		// example, the two space keys on a Kinesis Freestyle 2). They share an
		// assignment, rather than being given invented source tokens.
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
	if profile.Layers[0].ID != "base" {
		return fmt.Errorf("the base layer must be the first layer")
	}
	for _, layer := range profile.Layers {
		if !identifier.MatchString(layer.ID) {
			return fmt.Errorf("invalid layer ID %q", layer.ID)
		}
		if len([]rune(layer.Name)) > maxNameLength {
			return fmt.Errorf("layer name %q is longer than %d characters", layer.Name, maxNameLength)
		}
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
		if !identifier.MatchString(name) {
			return fmt.Errorf("invalid alias name %q", name)
		}
		if err := validateBehavior(behavior, layers, profile.Aliases, profile.Macros); err != nil {
			return fmt.Errorf("alias %q: %w", name, err)
		}
	}
	for name, macro := range profile.Macros {
		if !identifier.MatchString(name) || len(macro) == 0 {
			return fmt.Errorf("macro %q needs a valid name and at least one step", name)
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
