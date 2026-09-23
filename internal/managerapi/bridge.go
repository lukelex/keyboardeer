package managerapi

import (
	"context"
	"errors"
	"time"
)

// ConnectionStatus is deliberately conservative. In normal application mode a
// successful hello is insufficient: manager.get must establish capabilities.
type ConnectionStatus struct {
	State        string       `json:"state"`
	Message      string       `json:"message"`
	Endpoint     string       `json:"endpoint"`
	ServerID     string       `json:"server_id,omitempty"`
	Version      string       `json:"manager_version,omitempty"`
	Capability   string       `json:"capability,omitempty"`
	Capabilities []Capability `json:"capabilities,omitempty"`
}

func (c *APIClient) Bootstrap(ctx context.Context) ConnectionStatus {
	status := ConnectionStatus{Endpoint: c.endpoint}
	hello, err := c.Hello(ctx)
	if err != nil {
		if errors.Is(err, ErrReconnecting) {
			status.State = "reconnecting"
			status.Message = "Waiting before the next manager connection attempt."
		} else {
			status.State = "unavailable"
			status.Message = "The manager socket could not be reached."
		}
		return status
	}
	status.ServerID, status.Version = hello.ServerID, hello.ManagerVersion
	info, err := c.ManagerGet(ctx)
	if err != nil {
		var apiError *Error
		if errors.As(err, &apiError) && apiError.Code == "unsupported_capability" {
			status.State = "incomplete"
			status.Capability = "manager.get"
			status.Message = "This manager cannot report the capabilities required for normal application use."
			return status
		}
		status.State = "unavailable"
		status.Message = "The manager connection did not return usable capability information."
		return status
	}
	if info.ServerID != "" && info.ServerID != hello.ServerID {
		status.State = "unavailable"
		status.Message = "The manager identity changed while KeyboarDeer was establishing its connection."
		return status
	}
	if info.ServerID != "" {
		status.ServerID = info.ServerID
	}
	status.Capabilities = info.Capabilities
	status.State = "ready"
	status.Message = "Manager capabilities are available."
	return status
}

func (c *APIClient) StatusWithTimeout(timeout time.Duration) ConnectionStatus {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	return c.Bootstrap(ctx)
}

// Workspace is the capability-gated normal application read model. The
// snapshot is the authoritative source for Devices and runtime state.
type Workspace struct {
	Status     ConnectionStatus `json:"status"`
	Snapshot   *Snapshot        `json:"snapshot,omitempty"`
	Stale      bool             `json:"stale"`
	SnapshotAt time.Time        `json:"snapshot_at,omitempty"`
}

func CapabilityAvailable(capabilities []Capability, name string) (bool, string) {
	for _, capability := range capabilities {
		if capability.Name == name {
			return capability.Available, capability.Reason
		}
	}
	return false, "The connected manager did not advertise this capability."
}

func (c *APIClient) LoadWorkspace(ctx context.Context) Workspace {
	status := c.Bootstrap(ctx)
	workspace := Workspace{Status: status}
	if status.State != "ready" {
		return workspace
	}
	available, reason := CapabilityAvailable(status.Capabilities, "device_discovery")
	if !available {
		workspace.Status.State = "incomplete"
		workspace.Status.Capability = "device_discovery"
		workspace.Status.Message = reason
		return workspace
	}
	snapshot, err := c.SnapshotGet(ctx)
	if err != nil {
		workspace.Status.State = "unavailable"
		workspace.Status.Message = "The manager could not load its authoritative workspace snapshot."
		return workspace
	}
	workspace.Snapshot = &snapshot
	workspace.SnapshotAt = time.Now().UTC()
	return workspace
}
