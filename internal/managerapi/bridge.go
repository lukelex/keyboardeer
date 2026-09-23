package managerapi

import (
	"context"
	"errors"
	"time"
)

// ConnectionStatus is deliberately conservative. In normal application mode a
// successful hello is insufficient: manager.get must establish capabilities.
type ConnectionStatus struct {
	State      string `json:"state"`
	Message    string `json:"message"`
	Endpoint   string `json:"endpoint"`
	ServerID   string `json:"server_id,omitempty"`
	Version    string `json:"manager_version,omitempty"`
	Capability string `json:"capability,omitempty"`
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
	_ = info // The frontend receives per-capability data with the future snapshot bridge.
	status.State = "ready"
	status.Message = "Manager capabilities are available."
	return status
}

func (c *APIClient) StatusWithTimeout(timeout time.Duration) ConnectionStatus {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	return c.Bootstrap(ctx)
}
