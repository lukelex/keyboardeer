package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/lukelex/keyboardeer/internal/geometry"
	"github.com/lukelex/keyboardeer/internal/managerapi"
	"github.com/lukelex/keyboardeer/internal/profile"
)

func TestAppCreatesPersistsAndCompilesExplicitGeometryProfile(t *testing.T) {
	app := newAppWithProfileStore(profile.NewStore(filepath.Join(t.TempDir(), "profiles.json")))
	defer app.manager.Close()
	draft, err := app.CreateProfile("device-1", "Everyday", geometry.ANSI60USID)
	if err != nil {
		t.Fatal(err)
	}
	if draft.Geometry.ID != geometry.ANSI60USID || draft.DraftRevision != 1 {
		t.Fatalf("unexpected created draft: %#v", draft)
	}
	profiles, err := app.Profiles()
	if err != nil || len(profiles) != 1 || profiles[0].ID != draft.ID {
		t.Fatalf("Profiles = %#v, %v", profiles, err)
	}
	compiled, err := app.CompileProfile(draft.ID)
	if err != nil {
		t.Fatal(err)
	}
	if compiled.Behavior == "" || len(compiled.SourceMap) != len(draft.Geometry.SourceKeys) {
		t.Fatalf("compile result = %#v", compiled)
	}
	if _, err := app.CreateProfile("device-1", "Unknown", "guessed-from-product-name"); err == nil {
		t.Fatal("CreateProfile accepted an unverified geometry")
	}
}

func TestAppPreviewsThePersistedCompiledDraft(t *testing.T) {
	endpoint := testPreviewManager(t)
	client := managerapi.New(managerapi.Options{Endpoint: endpoint, ClientName: "keyboardeer-test", ClientVersion: "test"})
	app := &App{manager: client, profiles: profile.NewStore(filepath.Join(t.TempDir(), "profiles.json"))}
	defer app.manager.Close()
	draft, err := app.CreateProfile("device-1", "Everyday", geometry.ANSI60USID)
	if err != nil {
		t.Fatal(err)
	}
	preview, err := app.PreviewProfile(draft.ID)
	if err != nil {
		t.Fatal(err)
	}
	if preview.ProfileID != draft.ID || preview.DraftRevision != draft.DraftRevision || preview.ManagerServerID != "server-1" || preview.Validation.Outcome != "valid" || len(preview.SourceMap) != 61 {
		t.Fatalf("unexpected preview: %#v", preview)
	}
}

func testPreviewManager(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "api.sock")
	listener, err := net.Listen("unix", path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = listener.Close()
		_ = os.Remove(path)
	})
	var connections sync.WaitGroup
	connections.Add(1)
	go func() {
		defer connections.Done()
		connection, err := listener.Accept()
		if err != nil {
			return
		}
		defer connection.Close()
		scanner := bufio.NewScanner(connection)
		for scanner.Scan() {
			var request struct {
				ID     string `json:"id"`
				Method string `json:"method"`
			}
			if err := json.Unmarshal(scanner.Bytes(), &request); err != nil {
				t.Error(err)
				return
			}
			result := ""
			switch request.Method {
			case "session.hello":
				result = `{"selected_version":1,"server_id":"server-1","manager_version":"test"}`
			case "manager.get":
				result = `{"server_id":"server-1","state_revision":9,"capabilities":[{"name":"candidate_validation","available":true,"reason_code":"capability_available","reason":"ready"}]}`
			case "validation.preview":
				result = `{"validation":{"outcome":"valid","reason_code":"validation_succeeded","reason":"accepted","diagnostics":[]}}`
			default:
				t.Errorf("unexpected manager method %q", request.Method)
				return
			}
			if _, err := fmt.Fprintf(connection, `{"type":"response","id":%q,"result":%s}`+"\n", request.ID, result); err != nil {
				t.Error(err)
				return
			}
		}
	}()
	t.Cleanup(connections.Wait)
	return path
}
