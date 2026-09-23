package main

import (
	"testing"
	"time"

	"github.com/lukelex/keyboardeer/internal/managerapi"
)

func TestInfo(t *testing.T) {
	info := NewApp().Info()
	if info.Name != "KeyboarDeer" || info.Version == "" {
		t.Fatalf("unexpected app info: %#v", info)
	}
}

func TestRecordWorkspaceRetainsLastSnapshotAsStaleContext(t *testing.T) {
	app := &App{}
	freshAt := time.Date(2026, time.September, 24, 12, 0, 0, 0, time.UTC)
	fresh := app.recordWorkspace(managerapi.Workspace{
		Status: managerapi.ConnectionStatus{
			State: "ready", ServerID: "server-1",
			Capabilities: []managerapi.Capability{{Name: "device_discovery", Available: true}},
		},
		Snapshot:   &managerapi.Snapshot{StateRevision: 7},
		SnapshotAt: freshAt,
	})
	if fresh.Stale {
		t.Fatal("fresh snapshot was marked stale")
	}
	stale := app.recordWorkspace(managerapi.Workspace{
		Status: managerapi.ConnectionStatus{State: "unavailable", Message: "socket unavailable"},
	})
	if !stale.Stale || stale.Snapshot == nil || stale.Snapshot.StateRevision != 7 {
		t.Fatalf("stale workspace did not retain the last snapshot: %#v", stale)
	}
	if stale.SnapshotAt != freshAt || stale.Status.ServerID != "server-1" || len(stale.Status.Capabilities) != 1 {
		t.Fatalf("stale workspace lost snapshot provenance: %#v", stale)
	}
}

func TestWorkspaceEventStreamRequiresFreshAdvertisedCapability(t *testing.T) {
	workspace := managerapi.Workspace{
		Status: managerapi.ConnectionStatus{
			State:        "ready",
			Capabilities: []managerapi.Capability{{Name: "event_stream", Available: true}},
		},
		Snapshot: &managerapi.Snapshot{},
	}
	if !workspaceEventStreamAvailable(workspace) {
		t.Fatal("fresh workspace with event_stream capability was not eligible")
	}
	workspace.Stale = true
	if workspaceEventStreamAvailable(workspace) {
		t.Fatal("stale workspace was eligible for event subscription")
	}
	workspace.Stale = false
	workspace.Status.Capabilities[0].Available = false
	if workspaceEventStreamAvailable(workspace) {
		t.Fatal("workspace without event_stream capability was eligible")
	}
}
