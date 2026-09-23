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

type shortWriteConn struct {
	net.Conn
	maximum int
}

func (c shortWriteConn) Write(data []byte) (int, error) {
	if len(data) > c.maximum {
		data = data[:c.maximum]
	}
	return c.Conn.Write(data)
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

func TestClientCompletesAFrameAfterShortWrites(t *testing.T) {
	socket := testSocket(t, func(rw *bufio.ReadWriter, request capturedRequest) {
		switch request.Method {
		case "session.hello":
			writeResult(t, rw, request.ID, `{"selected_version":1,"server_id":"server-1","manager_version":"test"}`)
		case "device.list":
			writeResult(t, rw, request.ID, `{"devices":[]}`)
		default:
			t.Errorf("unexpected method %s", request.Method)
		}
	})
	client := New(Options{
		Endpoint: socket,
		Dial: func(ctx context.Context, network, address string) (net.Conn, error) {
			connection, err := (&net.Dialer{}).DialContext(ctx, network, address)
			if err != nil {
				return nil, err
			}
			return shortWriteConn{Conn: connection, maximum: 3}, nil
		},
	})
	defer client.Close()
	if _, err := client.DeviceList(context.Background()); err != nil {
		t.Fatalf("device list over short-writing connection: %v", err)
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

func TestConfigurationWritesUseExplicitCreateAndRevisionCheckedUpdate(t *testing.T) {
	var writes []ConfigurationWriteParams
	socket := testSocket(t, func(rw *bufio.ReadWriter, request capturedRequest) {
		switch request.Method {
		case "session.hello":
			writeResult(t, rw, request.ID, `{"selected_version":1,"server_id":"server","manager_version":"test"}`)
		case "configuration.create", "configuration.update":
			var params ConfigurationWriteParams
			if err := json.Unmarshal(request.Params, &params); err != nil {
				t.Error(err)
				return
			}
			writes = append(writes, params)
			writeResult(t, rw, request.ID, `{"operation":{"id":"op-1","kind":"apply","state":"succeeded","resource":{"kind":"configuration","id":"cfg-1"},"reason_code":"operation_succeeded","reason":"active"}}`)
		default:
			t.Errorf("unexpected method %s", request.Method)
		}
	})
	client := New(Options{Endpoint: socket})
	defer client.Close()
	model := PreviewModel{DeviceID: "dev-1", Behavior: "(defsrc caps)\n(deflayer base esc)"}
	created, err := client.ConfigurationCreate(context.Background(), ConfigurationWriteParams{Name: "My board", Model: model})
	if err != nil || created.Resource == nil || created.Resource.ID != "cfg-1" {
		t.Fatalf("create = %#v, %v", created, err)
	}
	revision := uint64(4)
	if _, err := client.ConfigurationUpdate(context.Background(), ConfigurationWriteParams{ConfigurationID: "cfg-1", Model: model, ExpectedRevision: &revision}); err != nil {
		t.Fatal(err)
	}
	if len(writes) != 2 || writes[0].ConfigurationID != "" || writes[0].ExpectedRevision != nil || writes[0].Name != "My board" {
		t.Fatalf("unexpected create parameters: %#v", writes)
	}
	if writes[1].ConfigurationID != "cfg-1" || writes[1].ExpectedRevision == nil || *writes[1].ExpectedRevision != 4 || writes[1].Name != "" {
		t.Fatalf("unexpected update parameters: %#v", writes[1])
	}
}

func TestConfigurationSetEnabledUsesTheObservedRevision(t *testing.T) {
	socket := testSocket(t, func(rw *bufio.ReadWriter, request capturedRequest) {
		switch request.Method {
		case "session.hello":
			writeResult(t, rw, request.ID, `{"selected_version":1,"server_id":"server","manager_version":"test"}`)
		case "configuration.set_enabled":
			var params ConfigurationSetEnabledParams
			if err := json.Unmarshal(request.Params, &params); err != nil {
				t.Error(err)
				return
			}
			if params.ConfigurationID != "cfg-1" || params.ExpectedRevision != 7 || params.Enabled {
				t.Errorf("unexpected lifecycle parameters: %#v", params)
			}
			writeResult(t, rw, request.ID, `{"operation":{"id":"op-1","kind":"lifecycle","state":"succeeded","resource":{"kind":"configuration","id":"cfg-1"},"reason_code":"operation_succeeded","reason":"configuration disabled and its KMonad process stopped","configuration_revision":8}}`)
		default:
			t.Errorf("unexpected method %s", request.Method)
		}
	})
	client := New(Options{Endpoint: socket})
	defer client.Close()
	operation, err := client.ConfigurationSetEnabled(context.Background(), ConfigurationSetEnabledParams{ConfigurationID: "cfg-1", ExpectedRevision: 7, Enabled: false})
	if err != nil || operation.State != "succeeded" || operation.ConfigurationRevision != 8 {
		t.Fatalf("set enabled = %#v, %v", operation, err)
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

func TestBootstrapRejectsManagerIdentityChangeDuringNegotiation(t *testing.T) {
	socket := testSocket(t, func(rw *bufio.ReadWriter, request capturedRequest) {
		switch request.Method {
		case "session.hello":
			writeResult(t, rw, request.ID, `{"selected_version":1,"server_id":"server-before","manager_version":"test"}`)
		case "manager.get":
			writeResult(t, rw, request.ID, `{"server_id":"server-after","capabilities":[]}`)
		default:
			t.Errorf("unexpected method %s", request.Method)
		}
	})
	client := New(Options{Endpoint: socket})
	defer client.Close()
	status := client.Bootstrap(context.Background())
	if status.State != "unavailable" || status.ServerID != "server-before" {
		t.Fatalf("identity change status = %#v", status)
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

func TestSubscribeReplaysEventsAndEndsOnResync(t *testing.T) {
	socket := testSocket(t, func(rw *bufio.ReadWriter, request capturedRequest) {
		switch request.Method {
		case "session.hello":
			writeResult(t, rw, request.ID, `{"selected_version":1,"server_id":"server-1","manager_version":"test"}`)
		case "events.subscribe":
			var params EventSubscribeParams
			if err := json.Unmarshal(request.Params, &params); err != nil {
				t.Error(err)
				return
			}
			if params.AfterServerID != "server-1" || params.AfterEventID == nil || *params.AfterEventID != 4 {
				t.Errorf("unexpected cursor: %#v", params)
			}
			writeResult(t, rw, request.ID, `{"subscription_id":2,"server_id":"server-1","state_revision":8,"latest_event_id":6}`)
			if _, err := rw.WriteString(`{"type":"event","event_id":5,"state_revision":7,"time":"2026-09-23T00:00:00Z","event_type":"device.added","resource":{"kind":"device","id":"dev-1"},"reason_code":"device_connected","data":{}}` + "\n"); err != nil {
				t.Error(err)
				return
			}
			if _, err := rw.WriteString(`{"type":"event","event_id":6,"state_revision":8,"time":"2026-09-23T00:00:01Z","event_type":"manager.resync_required","resource":{"kind":"manager","id":"server-1"},"reason_code":"manager_resync_required","data":{}}` + "\n"); err != nil {
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
	subscription, err := client.Subscribe(context.Background(), EventCursor{ServerID: "server-1", EventID: 4})
	if err != nil {
		t.Fatal(err)
	}
	if subscription.Info.SubscriptionID != 2 || subscription.Info.LatestEventID != 6 {
		t.Fatalf("unexpected subscription: %#v", subscription.Info)
	}
	var types []string
	for event := range subscription.Events {
		types = append(types, event.Type)
	}
	if len(types) != 2 || types[0] != "device.added" || types[1] != "manager.resync_required" {
		t.Fatalf("events = %v", types)
	}
	if err := subscription.Err(); err != nil {
		t.Fatal(err)
	}
}
