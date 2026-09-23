package managerapi

import (
	"bufio"
	"context"
	"encoding/json"
	"net"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

type capturedRequest struct {
	Type   string          `json:"type"`
	ID     string          `json:"id"`
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
}

func testSocket(t *testing.T, handler func(*bufio.ReadWriter, capturedRequest)) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "manager.sock")
	listener, err := net.Listen("unix", path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = listener.Close(); _ = os.Remove(path) })
	go func() {
		for {
			connection, err := listener.Accept()
			if err != nil {
				return
			}
			go func() {
				defer connection.Close()
				rw := bufio.NewReadWriter(bufio.NewReader(connection), bufio.NewWriter(connection))
				for {
					line, err := rw.ReadBytes('\n')
					if err != nil {
						return
					}
					var request capturedRequest
					if json.Unmarshal(line, &request) == nil {
						handler(rw, request)
					}
				}
			}()
		}
	}()
	return path
}

func writeResult(t *testing.T, rw *bufio.ReadWriter, id string, result string) {
	t.Helper()
	if _, err := rw.WriteString(`{"type":"response","id":"` + id + `","result":` + result + "}\n"); err != nil {
		t.Fatal(err)
	}
	if err := rw.Flush(); err != nil {
		t.Fatal(err)
	}
}

func TestClientNegotiatesBeforeDeviceList(t *testing.T) {
	var methods []string
	var methodsMu sync.Mutex
	socket := testSocket(t, func(rw *bufio.ReadWriter, request capturedRequest) {
		methodsMu.Lock()
		methods = append(methods, request.Method)
		methodsMu.Unlock()
		switch request.Method {
		case "session.hello":
			writeResult(t, rw, request.ID, `{"selected_version":1,"server_id":"server-1","manager_version":"test","state_revision":0}`)
		case "device.list":
			writeResult(t, rw, request.ID, `{"devices":[{"id":"dev-1","display_name":"Test board","availability":"connected","identity_stability":"serial","configured_by":[],"runtime_conflict":false,"reason_code":"device_connected","reason":"connected"}]}`)
		default:
			t.Errorf("unexpected method %s", request.Method)
		}
	})
	client := New(Options{Endpoint: socket})
	t.Cleanup(func() { _ = client.Close() })
	result, err := client.DeviceList(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Devices) != 1 || result.Devices[0].ID != "dev-1" {
		t.Fatalf("unexpected result: %#v", result)
	}
	methodsMu.Lock()
	defer methodsMu.Unlock()
	if len(methods) != 2 || methods[0] != "session.hello" || methods[1] != "device.list" {
		t.Fatalf("request order = %v", methods)
	}
}

func TestEndpointFromEnvironment(t *testing.T) {
	if got := EndpointFromEnvironment(func(string) string { return "/run/user/1000" }, "/home/deer"); got != "/run/user/1000/kmonad-device-manager/api.sock" {
		t.Fatal(got)
	}
	if got := EndpointFromEnvironment(func(string) string { return "" }, "/home/deer"); got != "/home/deer/.config/kmonad-device-manager/api.sock" {
		t.Fatal(got)
	}
}

func TestClientRejectsOversizedFrameBeforeWriting(t *testing.T) {
	client := New(Options{Endpoint: filepath.Join(t.TempDir(), "unused.sock")})
	defer client.Close()
	_, err := client.Preview(context.Background(), PreviewParams{Content: string(make([]byte, MaxFrameBytes))})
	if err == nil {
		t.Fatal("expected an error")
	}
}

func TestClientHonoursResponseCorrelation(t *testing.T) {
	socket := testSocket(t, func(rw *bufio.ReadWriter, request capturedRequest) {
		if request.Method == "session.hello" {
			writeResult(t, rw, request.ID, `{"selected_version":1,"server_id":"server","manager_version":"test"}`)
			return
		}
		go func(id string) {
			time.Sleep(10 * time.Millisecond)
			writeResult(t, rw, id, `{"operation":{"id":"op","kind":"identify","state":"waiting","reason_code":"operation_running","reason":"waiting"}}`)
		}(request.ID)
	})
	client := New(Options{Endpoint: socket})
	defer client.Close()
	if _, err := client.IdentifyStart(context.Background(), IdentifyStartParams{DeviceID: "dev", TimeoutMS: 1000}); err != nil {
		t.Fatal(err)
	}
}

func TestWorkspaceDoesNotFetchSnapshotWhenManagerGetIsUnsupported(t *testing.T) {
	var methods []string
	var methodsMu sync.Mutex
	socket := testSocket(t, func(rw *bufio.ReadWriter, request capturedRequest) {
		methodsMu.Lock()
		methods = append(methods, request.Method)
		methodsMu.Unlock()
		switch request.Method {
		case "session.hello":
			writeResult(t, rw, request.ID, `{"selected_version":1,"server_id":"server","manager_version":"test"}`)
		case "manager.get":
			if _, err := rw.WriteString(`{"type":"response","id":"` + request.ID + `","error":{"code":"unsupported_capability","message":"not ready"}}` + "\n"); err != nil {
				t.Error(err)
				return
			}
			if err := rw.Flush(); err != nil {
				t.Error(err)
			}
		default:
			t.Errorf("unexpected method %s", request.Method)
		}
	})
	client := New(Options{Endpoint: socket})
	defer client.Close()
	workspace := client.LoadWorkspace(context.Background())
	if workspace.Status.State != "incomplete" || workspace.Status.Capability != "manager.get" {
		t.Fatalf("unexpected workspace: %#v", workspace)
	}
	methodsMu.Lock()
	defer methodsMu.Unlock()
	if len(methods) != 2 {
		t.Fatalf("snapshot.get must not run without manager.get, methods=%v", methods)
	}
}

func TestWorkspaceUsesSnapshotAfterCapabilityNegotiation(t *testing.T) {
	socket := testSocket(t, func(rw *bufio.ReadWriter, request capturedRequest) {
		switch request.Method {
		case "session.hello":
			writeResult(t, rw, request.ID, `{"selected_version":1,"server_id":"server","manager_version":"test"}`)
		case "manager.get":
			writeResult(t, rw, request.ID, `{"capabilities":[{"name":"device_discovery","available":true,"reason_code":"capability_available","reason":"available"}]}`)
		case "snapshot.get":
			writeResult(t, rw, request.ID, `{"state_revision":12,"event_cursor":{"server_id":"server","event_id":7,"state_revision":12},"devices":[{"id":"dev-1","display_name":"Test","availability":"connected","identity_stability":"serial","configured_by":[],"reason_code":"device_connected","reason":"connected"}],"configurations":[],"operations":[],"health":{"healthy":true,"reason_code":"manager_healthy","reason":"healthy"}}`)
		default:
			t.Errorf("unexpected method %s", request.Method)
		}
	})
	client := New(Options{Endpoint: socket})
	defer client.Close()
	workspace := client.LoadWorkspace(context.Background())
	if workspace.Status.State != "ready" || workspace.Snapshot == nil || len(workspace.Snapshot.Devices) != 1 || workspace.Snapshot.EventCursor.EventID != 7 {
		t.Fatalf("unexpected workspace: %#v", workspace)
	}
}

func TestManagerGetDecodesPublicMetadata(t *testing.T) {
	socket := testSocket(t, func(rw *bufio.ReadWriter, request capturedRequest) {
		switch request.Method {
		case "session.hello":
			writeResult(t, rw, request.ID, `{"selected_version":1,"server_id":"hello-server","manager_version":"hello-version"}`)
		case "manager.get":
			writeResult(t, rw, request.ID, `{"api_versions":[1],"manager_version":"manager-version","server_id":"server-2","platform":"linux","backend":"linux-evdev","state_revision":14,"event_cursor":{"server_id":"server-2","event_id":8,"state_revision":14},"limits":{"api_frame_bytes":1048576,"event_history":1024},"capabilities":[],"health":{"healthy":true,"reason_code":"manager_healthy","reason":"responsive","reconcile_count":7}}`)
		default:
			t.Errorf("unexpected method %s", request.Method)
		}
	})
	client := New(Options{Endpoint: socket})
	defer client.Close()
	info, err := client.ManagerGet(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if info.ServerID != "server-2" || info.EventCursor.EventID != 8 || info.Limits.EventHistory != 1024 || !info.Health.Healthy {
		t.Fatalf("unexpected manager metadata: %#v", info)
	}
}
