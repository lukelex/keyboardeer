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
	APIVersions    []int         `json:"api_versions"`
	ManagerVersion string        `json:"manager_version"`
	ServerID       string        `json:"server_id"`
	Platform       string        `json:"platform"`
	Backend        string        `json:"backend"`
	StateRevision  uint64        `json:"state_revision"`
	EventCursor    EventCursor   `json:"event_cursor"`
	Limits         ManagerLimits `json:"limits"`
	Capabilities   []Capability  `json:"capabilities"`
	Health         ManagerHealth `json:"health"`
}

type ManagerLimits struct {
	MaxConfigurations     int   `json:"max_configurations"`
	MaxConfigurationBytes int64 `json:"max_configuration_bytes"`
	CommandQueue          int   `json:"command_queue"`
	EventHistory          int   `json:"event_history"`
	EventSubscriberQueue  int   `json:"event_subscriber_queue"`
	APIMaxClients         int   `json:"api_max_clients"`
	APIInFlightRequests   int   `json:"api_in_flight_requests"`
	APIFrameBytes         int   `json:"api_frame_bytes"`
	DefaultDeadlineMS     int64 `json:"default_deadline_ms"`
}

type ManagerHealth struct {
	Healthy             bool   `json:"healthy"`
	ReasonCode          string `json:"reason_code"`
	Reason              string `json:"reason"`
	LastProgressAt      string `json:"last_progress_at,omitempty"`
	ReconcileCount      uint64 `json:"reconcile_count"`
	FailureCount        uint64 `json:"failure_count"`
	MetricsAvailable    bool   `json:"metrics_available"`
	StatusWriteFailures uint64 `json:"status_write_failures"`
}

type EventCursor struct {
	ServerID      string `json:"server_id"`
	EventID       uint64 `json:"event_id"`
	StateRevision uint64 `json:"state_revision"`
}

type EventSubscribeParams struct {
	AfterEventID  *uint64 `json:"after_event_id,omitempty"`
	AfterServerID string  `json:"after_server_id,omitempty"`
}

type EventSubscriptionInfo struct {
	SubscriptionID uint64 `json:"subscription_id"`
	ServerID       string `json:"server_id"`
	StateRevision  uint64 `json:"state_revision"`
	LatestEventID  uint64 `json:"latest_event_id"`
}

type Event struct {
	EventID       uint64         `json:"event_id"`
	StateRevision uint64         `json:"state_revision"`
	Time          string         `json:"time"`
	Type          string         `json:"event_type"`
	Resource      ResourceRef    `json:"resource"`
	ReasonCode    string         `json:"reason_code"`
	Data          map[string]any `json:"data"`
}

type Device struct {
	ID                string   `json:"id"`
	DisplayName       string   `json:"display_name"`
	// Role is optional for compatibility with managers that predate semantic
	// device roles. Explicit non-input roles are not configurable.
	Role              string   `json:"role,omitempty"`
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

type RuntimeState struct {
	Phase        string `json:"phase"`
	ReasonCode   string `json:"reason_code"`
	Reason       string `json:"reason"`
	Connected    bool   `json:"connected"`
	Healthy      bool   `json:"healthy"`
	RetryAt      string `json:"retry_at,omitempty"`
	FailureCount int    `json:"failure_count"`
}

type Configuration struct {
	ID              string       `json:"id"`
	Name            string       `json:"name"`
	Ownership       string       `json:"ownership"`
	Enabled         bool         `json:"enabled"`
	DeviceID        string       `json:"device_id"`
	DesiredRevision uint64       `json:"desired_revision"`
	ActiveRevision  uint64       `json:"active_revision"`
	Runtime         RuntimeState `json:"runtime"`
	LastOperation   *Operation   `json:"last_operation,omitempty"`
}

type Snapshot struct {
	StateRevision  uint64          `json:"state_revision"`
	EventCursor    EventCursor     `json:"event_cursor"`
	Devices        []Device        `json:"devices"`
	Configurations []Configuration `json:"configurations"`
	Operations     []Operation     `json:"operations"`
	Health         ManagerHealth   `json:"health"`
}

type ResourceRef struct {
	Kind string `json:"kind"`
	ID   string `json:"id"`
}

type Operation struct {
	ID                    string            `json:"id"`
	Kind                  string            `json:"kind"`
	State                 string            `json:"state"`
	Resource              *ResourceRef      `json:"resource,omitempty"`
	StartedAt             string            `json:"started_at"`
	UpdatedAt             string            `json:"updated_at"`
	ReasonCode            string            `json:"reason_code"`
	Reason                string            `json:"reason"`
	ConfigurationRevision uint64            `json:"configuration_revision,omitempty"`
	Validation            *ValidationResult `json:"validation,omitempty"`
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

// ConfigurationWriteParams intentionally contains only a platform-neutral
// behavior model. The manager owns device-specific defcfg rendering.
type ConfigurationWriteParams struct {
	ConfigurationID  string       `json:"configuration_id,omitempty"`
	Name             string       `json:"name,omitempty"`
	Model            PreviewModel `json:"model"`
	ExpectedRevision *uint64      `json:"expected_revision,omitempty"`
}

type ConfigurationWriteResult struct {
	Operation Operation `json:"operation"`
}

// ConfigurationSetEnabledParams is a lifecycle operation for an existing
// manager-owned configuration. ExpectedRevision prevents changing a newer
// runtime state observed by another client.
type ConfigurationSetEnabledParams struct {
	ConfigurationID  string `json:"configuration_id"`
	ExpectedRevision uint64 `json:"expected_revision"`
	Enabled          bool   `json:"enabled"`
}

type ConfigurationSetEnabledResult struct {
	Operation Operation `json:"operation"`
}

// ConfigurationDeleteParams stops and removes a manager-owned configuration.
// ExpectedRevision prevents deleting a newer revision applied by another client.
type ConfigurationDeleteParams struct {
	ConfigurationID  string `json:"configuration_id"`
	ExpectedRevision uint64 `json:"expected_revision"`
}
