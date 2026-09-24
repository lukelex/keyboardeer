package managerapi

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
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
	// IdempotencyKey is present on durable mutation requests.
	IdempotencyKey string `json:"idempotency_key"`
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

func TestClientPreviewPreservesCandidateDigestAndDiagnosticLocation(t *testing.T) {
	const digest = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	socket := testSocket(t, func(rw *bufio.ReadWriter, request capturedRequest) {
		switch request.Method {
		case "session.hello":
			writeResult(t, rw, request.ID, `{"selected_version":1,"server_id":"server-1","manager_version":"test","state_revision":0}`)
		case "validation.preview":
			var params PreviewParams
			if err := json.Unmarshal(request.Params, &params); err != nil || params.Model == nil || params.Model.Behavior != "(defsrc a)" {
				t.Errorf("preview params = %#v, decode error = %v", params, err)
			}
			writeResult(t, rw, request.ID, `{"validation":{"outcome":"rejected","reason_code":"validation_failed","reason":"rejected","candidate_digest":"`+digest+`","diagnostics":[{"id":"diag-1","severity":"error","reason_code":"validation_failed","summary":"rejected","remediation":"fix it","location":{"scope":"future_scope","start_line":2,"start_column":3,"end_line":2,"end_column":4}}]}}`)
		default:
			t.Errorf("unexpected method %s", request.Method)
		}
	})
	client := New(Options{Endpoint: socket})
	defer client.Close()
	result, err := client.Preview(context.Background(), PreviewParams{Model: &PreviewModel{DeviceID: "device-1", Behavior: "(defsrc a)"}})
	if err != nil {
		t.Fatal(err)
	}
	if result.Validation.CandidateDigest != digest || len(result.Validation.Diagnostics) != 1 {
		t.Fatalf("preview validation = %#v", result.Validation)
	}
	location := result.Validation.Diagnostics[0].Location
	if location == nil || location.Scope != "future_scope" || location.StartLine != 2 || location.StartColumn != 3 || location.EndLine != 2 || location.EndColumn != 4 {
		t.Fatalf("diagnostic location = %#v", location)
	}
}

func TestManagerValidationLocationJSONLinesFixture(t *testing.T) {
	file, err := os.Open(filepath.Join("..", "..", "tests", "fixtures", "validation-preview-locations.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()

	type frame struct {
		Type   string `json:"type"`
		ID     string `json:"id"`
		Params struct {
			Model struct {
				Behavior string `json:"behavior"`
			} `json:"model"`
		} `json:"params"`
		Result json.RawMessage `json:"result"`
	}
	responses := map[string]ValidationResult{}
	requests := map[string]string{}
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		var value frame
		if err := json.Unmarshal(scanner.Bytes(), &value); err != nil {
			t.Fatalf("decode fixture frame: %v", err)
		}
		if value.Type != "response" {
			requests[value.ID] = value.Params.Model.Behavior
			continue
		}
		var preview PreviewResult
		if err := json.Unmarshal(value.Result, &preview); err != nil {
			t.Fatalf("decode %s result as manager preview: %v", value.ID, err)
		}
		responses[value.ID] = preview.Validation
	}
	if err := scanner.Err(); err != nil {
		t.Fatal(err)
	}

	mapped := responses["mapped-rejection"]
	if mapped.Outcome != "rejected" || len(mapped.Diagnostics) != 1 ||
		mapped.CandidateDigest != "sha256:5d5146d001b73ad7e72168f8c69cb1f598d1f2b27f67a969aa057d5be21aa4c7" ||
		mapped.Diagnostics[0].Location == nil || mapped.Diagnostics[0].Location.Scope != "submitted_behavior" {
		t.Fatalf("mapped fixture response = %#v", mapped)
	}
	digest := sha256.Sum256([]byte(requests["mapped-rejection"]))
	if want := "sha256:" + hex.EncodeToString(digest[:]); mapped.CandidateDigest != want {
		t.Fatalf("mapped candidate digest = %q, want exact request digest %q", mapped.CandidateDigest, want)
	}
	if unmapped := responses["unmapped-rejection"]; unmapped.Outcome != "rejected" || len(unmapped.Diagnostics) != 1 || unmapped.Diagnostics[0].Location != nil {
		t.Fatalf("unmapped fixture response = %#v", unmapped)
	}
	if blocked := responses["blocked-preview"]; blocked.Outcome != "blocked" || len(blocked.Diagnostics) != 1 || blocked.Diagnostics[0].Location != nil {
		t.Fatalf("blocked fixture response = %#v", blocked)
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

func TestClientMatchesConcurrentResponsesByRequestID(t *testing.T) {
	var received []capturedRequest
	var mu sync.Mutex
	completed := make(chan struct{})
	socket := testSocket(t, func(rw *bufio.ReadWriter, request capturedRequest) {
		if request.Method == "session.hello" {
			writeResult(t, rw, request.ID, `{"selected_version":1,"server_id":"server","manager_version":"test"}`)
			return
		}
		mu.Lock()
		received = append(received, request)
		if len(received) != 2 {
			mu.Unlock()
			return
		}
		batch := append([]capturedRequest(nil), received...)
		mu.Unlock()
		for index := len(batch) - 1; index >= 0; index-- {
			var params IdentifyStartParams
			if err := json.Unmarshal(batch[index].Params, &params); err != nil {
				t.Error(err)
				continue
			}
			writeResult(t, rw, batch[index].ID, `{"operation":{"id":"op-`+params.DeviceID+`","kind":"identify","state":"waiting","reason_code":"operation_running","reason":"waiting"}}`)
		}
		close(completed)
	})
	client := New(Options{Endpoint: socket})
	defer client.Close()
	type result struct {
		device string
		id     string
		err    error
	}
	results := make(chan result, 2)
	for _, device := range []string{"dev-a", "dev-b"} {
		go func(device string) {
			operation, err := client.IdentifyStart(context.Background(), IdentifyStartParams{DeviceID: device, TimeoutMS: 1000})
			results <- result{device: device, id: operation.ID, err: err}
		}(device)
	}
	select {
	case <-completed:
	case <-time.After(time.Second):
		t.Fatal("server did not receive both concurrent requests")
	}
	for range 2 {
		got := <-results
		if got.err != nil || got.id != "op-"+got.device {
			t.Fatalf("response mismatch: %#v", got)
		}
	}
}

func TestClientReconnectsAfterManagerDisconnect(t *testing.T) {
	path := filepath.Join(t.TempDir(), "manager.sock")
	listener, err := net.Listen("unix", path)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	accepted := make(chan int, 2)
	go func() {
		for connectionNumber := 1; connectionNumber <= 2; connectionNumber++ {
			connection, acceptErr := listener.Accept()
			if acceptErr != nil {
				return
			}
			accepted <- connectionNumber
			go func(number int, connection net.Conn) {
				defer connection.Close()
				rw := bufio.NewReadWriter(bufio.NewReader(connection), bufio.NewWriter(connection))
				for {
					line, readErr := rw.ReadBytes('\n')
					if readErr != nil {
						return
					}
					var request capturedRequest
					if json.Unmarshal(line, &request) != nil {
						return
					}
					switch request.Method {
					case "session.hello":
						writeResult(t, rw, request.ID, `{"selected_version":1,"server_id":"server","manager_version":"test"}`)
					case "device.list":
						if number == 1 {
							writeResult(t, rw, request.ID, `{"devices":[]}`)
							return
						}
						writeResult(t, rw, request.ID, `{"devices":[]}`)
					}
				}
			}(connectionNumber, connection)
		}
	}()
	client := New(Options{Endpoint: path, ReconnectInitial: 5 * time.Millisecond})
	defer client.Close()
	if _, err := client.DeviceList(context.Background()); err != nil {
		t.Fatal(err)
	}
	select {
	case <-accepted:
	case <-time.After(time.Second):
		t.Fatal("initial connection was not accepted")
	}
	deadline := time.Now().Add(time.Second)
	for {
		devices, callErr := client.DeviceList(context.Background())
		if callErr == nil {
			if len(devices.Devices) != 0 {
				t.Fatalf("unexpected devices after reconnect: %#v", devices)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("client did not recover after disconnect: %v", callErr)
		}
		time.Sleep(5 * time.Millisecond)
	}
	select {
	case number := <-accepted:
		if number != 2 {
			t.Fatalf("accepted connection number %d, want 2", number)
		}
	case <-time.After(time.Second):
		t.Fatal("reconnect did not establish a second socket")
	}
}

func TestClientReturnsContextDeadlineForAnUnresponsiveRequest(t *testing.T) {
	socket := testSocket(t, func(rw *bufio.ReadWriter, request capturedRequest) {
		if request.Method == "session.hello" {
			writeResult(t, rw, request.ID, `{"selected_version":1,"server_id":"server","manager_version":"test"}`)
		}
	})
	client := New(Options{Endpoint: socket})
	defer client.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if _, err := client.DeviceList(ctx); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("unresponsive request error = %v", err)
	}
}

func TestConfigurationWritesUseExplicitCreateAndRevisionCheckedUpdate(t *testing.T) {
	var writes []ConfigurationWriteParams
	var keys []string
	socket := testSocket(t, func(rw *bufio.ReadWriter, request capturedRequest) {
		switch request.Method {
		case "session.hello":
			if request.IdempotencyKey != "" {
				t.Errorf("read-only request carried an idempotency key: %q", request.IdempotencyKey)
			}
			writeResult(t, rw, request.ID, `{"selected_version":1,"server_id":"server","manager_version":"test"}`)
		case "configuration.create", "configuration.update":
			keys = append(keys, request.IdempotencyKey)
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
	created, err := client.ConfigurationCreate(context.Background(), ConfigurationWriteParams{Name: "My board", Model: model}, "key-create")
	if err != nil || created.Resource == nil || created.Resource.ID != "cfg-1" {
		t.Fatalf("create = %#v, %v", created, err)
	}
	revision := uint64(4)
	if _, err := client.ConfigurationUpdate(context.Background(), ConfigurationWriteParams{ConfigurationID: "cfg-1", Model: model, ExpectedRevision: &revision}, "key-update"); err != nil {
		t.Fatal(err)
	}
	if len(keys) != 2 || keys[0] != "key-create" || keys[1] != "key-update" {
		t.Fatalf("mutation keys = %v", keys)
	}
	if len(writes) != 2 || writes[0].ConfigurationID != "" || writes[0].ExpectedRevision != nil || writes[0].Name != "My board" {
		t.Fatalf("unexpected create parameters: %#v", writes)
	}
	if writes[1].ConfigurationID != "cfg-1" || writes[1].ExpectedRevision == nil || *writes[1].ExpectedRevision != 4 || writes[1].Name != "" {
		t.Fatalf("unexpected update parameters: %#v", writes[1])
	}
}

func TestConfigurationDeleteUsesTheObservedRevision(t *testing.T) {
	socket := testSocket(t, func(rw *bufio.ReadWriter, request capturedRequest) {
		switch request.Method {
		case "session.hello":
			writeResult(t, rw, request.ID, `{"selected_version":1,"server_id":"server","manager_version":"test"}`)
		case "configuration.delete":
			var params ConfigurationDeleteParams
			if err := json.Unmarshal(request.Params, &params); err != nil {
				t.Error(err)
				return
			}
			if params.ConfigurationID != "cfg-1" || params.ExpectedRevision != 7 || request.IdempotencyKey != "key-delete" {
				t.Errorf("unexpected delete request: %#v, key %q", params, request.IdempotencyKey)
			}
			writeResult(t, rw, request.ID, `{"operation":{"id":"op-2","kind":"lifecycle","state":"succeeded","resource":{"kind":"configuration","id":"cfg-1"},"reason_code":"operation_succeeded","reason":"configuration deleted and its KMonad process stopped","configuration_revision":0}}`)
		default:
			t.Errorf("unexpected method %s", request.Method)
		}
	})
	client := New(Options{Endpoint: socket})
	defer client.Close()
	operation, err := client.ConfigurationDelete(context.Background(), ConfigurationDeleteParams{ConfigurationID: "cfg-1", ExpectedRevision: 7}, "key-delete")
	if err != nil || operation.State != "succeeded" || operation.Reason == "" {
		t.Fatalf("delete = %#v, %v", operation, err)
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
			if params.ConfigurationID != "cfg-1" || params.ExpectedRevision != 7 || params.Enabled || request.IdempotencyKey != "key-enable" {
				t.Errorf("unexpected lifecycle request: %#v, key %q", params, request.IdempotencyKey)
			}
			writeResult(t, rw, request.ID, `{"operation":{"id":"op-1","kind":"lifecycle","state":"succeeded","resource":{"kind":"configuration","id":"cfg-1"},"reason_code":"operation_succeeded","reason":"configuration disabled and its KMonad process stopped","configuration_revision":8}}`)
		default:
			t.Errorf("unexpected method %s", request.Method)
		}
	})
	client := New(Options{Endpoint: socket})
	defer client.Close()
	operation, err := client.ConfigurationSetEnabled(context.Background(), ConfigurationSetEnabledParams{ConfigurationID: "cfg-1", ExpectedRevision: 7, Enabled: false}, "key-enable")
	if err != nil || operation.State != "succeeded" || operation.ConfigurationRevision != 8 {
		t.Fatalf("set enabled = %#v, %v", operation, err)
	}
}

func TestConfigurationExportRequestsManagerRenderedKBD(t *testing.T) {
	socket := testSocket(t, func(rw *bufio.ReadWriter, request capturedRequest) {
		switch request.Method {
		case "session.hello":
			writeResult(t, rw, request.ID, `{"selected_version":1,"server_id":"server","manager_version":"test"}`)
		case "configuration.export":
			var params ConfigurationExportParams
			if err := json.Unmarshal(request.Params, &params); err != nil {
				t.Error(err)
				return
			}
			if params.ConfigurationID != "cfg-1" || params.Format != "manager_rendered_kbd" {
				t.Errorf("unexpected export params: %#v", params)
			}
			writeResult(t, rw, request.ID, `{"configuration_id":"cfg-1","revision":3,"format":"manager_rendered_kbd","digest":"sha256:abc","content":"(defcfg)"}`)
		default:
			t.Errorf("unexpected method %s", request.Method)
		}
	})
	client := New(Options{Endpoint: socket})
	defer client.Close()
	result, err := client.ConfigurationExport(context.Background(), ConfigurationExportParams{
		ConfigurationID: "cfg-1",
		Format:          "manager_rendered_kbd",
	})
	if err != nil || result.Revision != 3 || result.Digest != "sha256:abc" || result.Content != "(defcfg)" {
		t.Fatalf("export = %#v, %v", result, err)
	}
}

func TestConfigurationContentUsesExpectedExternalRevision(t *testing.T) {
	socket := testSocket(t, func(rw *bufio.ReadWriter, request capturedRequest) {
		switch request.Method {
		case "session.hello":
			writeResult(t, rw, request.ID, `{"selected_version":1,"server_id":"server","manager_version":"test"}`)
		case "configuration.content.get":
			var params ConfigurationContentParams
			if err := json.Unmarshal(request.Params, &params); err != nil {
				t.Error(err)
				return
			}
			if params.ConfigurationID != "external-1" || params.ExpectedRevision != 42 {
				t.Errorf("unexpected content params: %#v", params)
			}
			writeResult(t, rw, request.ID, `{"configuration_id":"external-1","ownership":"external","content_revision":42,"digest":"sha256:abc","content":"(defcfg)"}`)
		default:
			t.Errorf("unexpected method %s", request.Method)
		}
	})
	client := New(Options{Endpoint: socket})
	defer client.Close()
	result, err := client.ConfigurationContent(context.Background(), ConfigurationContentParams{
		ConfigurationID: "external-1", ExpectedRevision: 42,
	})
	if err != nil || result.Ownership != "external" || result.ContentRevision != 42 || result.Content != "(defcfg)" {
		t.Fatalf("content = %#v, %v", result, err)
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

func TestWorkspaceDoesNotFetchDevicesWithoutDiscoveryCapability(t *testing.T) {
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
			writeResult(t, rw, request.ID, `{"server_id":"server","capabilities":[{"name":"device_discovery","available":false,"reason_code":"backend_unavailable","reason":"no input backend"}]}`)
		default:
			t.Errorf("unexpected method %s", request.Method)
		}
	})
	client := New(Options{Endpoint: socket})
	defer client.Close()
	workspace := client.LoadWorkspace(context.Background())
	if workspace.Status.State != "incomplete" || workspace.Status.Capability != "device_discovery" || workspace.Status.Message != "no input backend" {
		t.Fatalf("unexpected workspace: %#v", workspace)
	}
	methodsMu.Lock()
	defer methodsMu.Unlock()
	if len(methods) != 2 {
		t.Fatalf("snapshot.get must not run without device discovery, methods=%v", methods)
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
	if len(types) != 1 || types[0] != "device.added" {
		t.Fatalf("events = %v", types)
	}
	if !errors.Is(subscription.Err(), ErrEventResync) {
		t.Fatalf("subscription error = %v, want resync", subscription.Err())
	}
	if cursor := subscription.Cursor(); cursor.EventID != 5 || cursor.StateRevision != 7 {
		t.Fatalf("cursor advanced across resync: %#v", cursor)
	}
}

func TestSubscribeRejectsEventCursorGap(t *testing.T) {
	socket := testSocket(t, func(rw *bufio.ReadWriter, request capturedRequest) {
		switch request.Method {
		case "session.hello":
			writeResult(t, rw, request.ID, `{"selected_version":1,"server_id":"server-1","manager_version":"test"}`)
		case "events.subscribe":
			writeResult(t, rw, request.ID, `{"subscription_id":2,"server_id":"server-1","state_revision":8,"latest_event_id":7}`)
			if _, err := rw.WriteString(`{"type":"event","event_id":7,"state_revision":8,"time":"2026-09-23T00:00:00Z","event_type":"future.event","resource":{"kind":"device","id":"dev-1"},"reason_code":"future_reason","data":{}}` + "\n"); err != nil {
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
	subscription, err := client.Subscribe(context.Background(), EventCursor{ServerID: "server-1", EventID: 4, StateRevision: 6})
	if err != nil {
		t.Fatal(err)
	}
	for range subscription.Events {
	}
	if !errors.Is(subscription.Err(), ErrEventGap) {
		t.Fatalf("subscription error = %v, want cursor gap", subscription.Err())
	}
	if cursor := subscription.Cursor(); cursor.EventID != 4 {
		t.Fatalf("cursor advanced across gap: %#v", cursor)
	}
}

func TestSubscribeAcceptsUnknownEventsAndRejectsManagerRestart(t *testing.T) {
	t.Run("unknown event", func(t *testing.T) {
		socket := testSocket(t, func(rw *bufio.ReadWriter, request capturedRequest) {
			switch request.Method {
			case "session.hello":
				writeResult(t, rw, request.ID, `{"selected_version":1,"server_id":"server-1","manager_version":"test"}`)
			case "events.subscribe":
				writeResult(t, rw, request.ID, `{"subscription_id":2,"server_id":"server-1","state_revision":7,"latest_event_id":5}`)
				_, _ = rw.WriteString(`{"type":"event","event_id":5,"state_revision":7,"time":"2026-09-23T00:00:00Z","event_type":"future.event","resource":{"kind":"device","id":"dev-1"},"reason_code":"future_reason","data":{}}` + "\n")
				_ = rw.Flush()
			default:
				t.Errorf("unexpected method %s", request.Method)
			}
		})
		client := New(Options{Endpoint: socket})
		defer client.Close()
		subscription, err := client.Subscribe(context.Background(), EventCursor{ServerID: "server-1", EventID: 4, StateRevision: 6})
		if err != nil {
			t.Fatal(err)
		}
		event := <-subscription.Events
		if event.Type != "future.event" || subscription.Cursor().EventID != 5 {
			t.Fatalf("unknown event was not delivered: %#v, %#v", event, subscription.Cursor())
		}
		_ = subscription.Close()
	})
	t.Run("server changed", func(t *testing.T) {
		socket := testSocket(t, func(rw *bufio.ReadWriter, request capturedRequest) {
			switch request.Method {
			case "session.hello":
				writeResult(t, rw, request.ID, `{"selected_version":1,"server_id":"server-2","manager_version":"test"}`)
			case "events.subscribe":
				writeResult(t, rw, request.ID, `{"subscription_id":2,"server_id":"server-2","state_revision":1,"latest_event_id":0}`)
			default:
				t.Errorf("unexpected method %s", request.Method)
			}
		})
		client := New(Options{Endpoint: socket})
		defer client.Close()
		_, err := client.Subscribe(context.Background(), EventCursor{ServerID: "server-1", EventID: 4})
		if !errors.Is(err, ErrEventServerChanged) {
			t.Fatalf("subscribe error = %v, want manager restart", err)
		}
	})
}
