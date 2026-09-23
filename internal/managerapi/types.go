// Package managerapi is the thin API v1 client for kmonad-device-manager.
// It deliberately contains no platform input or KMonad process control.
package managerapi

import "encoding/json"

const (
	APIVersion      = 1
	MaxFrameBytes   = 1 << 20
	MaxInFlight     = 32
	MaxDeadlineMS   = 30_000
	DefaultDeadline = 10_000
)

type Error struct {
	Code    string          `json:"code"`
	Message string          `json:"message"`
	Details json.RawMessage `json:"details,omitempty"`
}

func (e *Error) Error() string {
	if e.Message != "" {
		return e.Code + ": " + e.Message
	}
	return e.Code
}

type HelloParams struct {
	SupportedVersions []int  `json:"supported_versions"`
	Client            Client `json:"client"`
}

type Client struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

type HelloResult struct {
	SelectedVersion int    `json:"selected_version"`
	ServerID        string `json:"server_id"`
	ManagerVersion  string `json:"manager_version"`
	StateRevision   uint64 `json:"state_revision"`
}

type Capability struct {
	Name       string `json:"name"`
	Available  bool   `json:"available"`
	ReasonCode string `json:"reason_code"`
	Reason     string `json:"reason"`
}

type ManagerInfo struct {
	APIVersions   []int        `json:"api_versions"`
	Platform      string       `json:"platform"`
	Backend       string       `json:"backend"`
	StateRevision uint64       `json:"state_revision"`
	Capabilities  []Capability `json:"capabilities"`
}

type Device struct {
	ID                string   `json:"id"`
	DisplayName       string   `json:"display_name"`
	Vendor            string   `json:"vendor,omitempty"`
	Product           string   `json:"product,omitempty"`
	Serial            string   `json:"serial,omitempty"`
	Availability      string   `json:"availability"`
	IdentityStability string   `json:"identity_stability"`
	ConfiguredBy      []string `json:"configured_by"`
	RuntimeConflict   bool     `json:"runtime_conflict"`
	ReasonCode        string   `json:"reason_code"`
	Reason            string   `json:"reason"`
}

type DeviceListResult struct {
	Devices []Device `json:"devices"`
}

type ResourceRef struct {
	Kind string `json:"kind"`
	ID   string `json:"id"`
}

type Operation struct {
	ID         string       `json:"id"`
	Kind       string       `json:"kind"`
	State      string       `json:"state"`
	Resource   *ResourceRef `json:"resource,omitempty"`
	StartedAt  string       `json:"started_at"`
	UpdatedAt  string       `json:"updated_at"`
	ReasonCode string       `json:"reason_code"`
	Reason     string       `json:"reason"`
}

type Diagnostic struct {
	ID          string       `json:"id"`
	Severity    string       `json:"severity"`
	ReasonCode  string       `json:"reason_code"`
	Summary     string       `json:"summary"`
	Remediation string       `json:"remediation"`
	Resource    *ResourceRef `json:"resource,omitempty"`
}

type ValidationResult struct {
	Outcome     string       `json:"outcome"`
	ReasonCode  string       `json:"reason_code"`
	Reason      string       `json:"reason"`
	Diagnostics []Diagnostic `json:"diagnostics"`
}

type IdentifyStartParams struct {
	DeviceID  string `json:"device_id"`
	TimeoutMS int    `json:"timeout_ms,omitempty"`
}

type OperationParams struct {
	OperationID string `json:"operation_id"`
}

type PreviewParams struct {
	Model *PreviewModel `json:"model,omitempty"`
	// Content is only retained for API completeness and development diagnosis.
	// GUI-owned profiles must use Model so the manager renders defcfg itself.
	Content string `json:"content,omitempty"`
}

type PreviewModel struct {
	DeviceID string `json:"device_id"`
	Behavior string `json:"behavior"`
}

type PreviewResult struct {
	Validation ValidationResult `json:"validation"`
}
