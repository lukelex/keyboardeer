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

func TestAppSaveProfileProtectsStoreOwnedFields(t *testing.T) {
	store := profile.NewStore(filepath.Join(t.TempDir(), "profiles.json"))
	app := newAppWithProfileStore(store)
	defer app.manager.Close()
	draft, err := app.CreateProfile("device-1", "Everyday", geometry.ANSI60USID)
	if err != nil {
		t.Fatal(err)
	}
	linked, err := store.SetApplyState(draft.ID, draft.DraftRevision, "cfg-1", nil)
	if err != nil {
		t.Fatal(err)
	}
	edited := linked
	edited.Name = "Renamed"
	edited.ManagerConfigurationID = "cfg-forged"
	saved, err := app.SaveProfile(edited)
	if err != nil {
		t.Fatal(err)
	}
	if saved.Name != "Renamed" || saved.ManagerConfigurationID != "cfg-1" {
		t.Fatalf("frontend edit changed manager link: %#v", saved)
	}
	for name, mutate := range map[string]func(*profile.Profile){
		"device":   func(p *profile.Profile) { p.DeviceID = "device-2" },
		"geometry": func(p *profile.Profile) { p.Geometry.ID = geometry.ANSITKLUSID },
		"order": func(p *profile.Profile) {
			p.Geometry.SourceKeys = append([]string{p.Geometry.SourceKeys[1], p.Geometry.SourceKeys[0]}, p.Geometry.SourceKeys[2:]...)
		},
	} {
		changed := saved
		changed.Geometry.SourceKeys = append([]string(nil), saved.Geometry.SourceKeys...)
		mutate(&changed)
		if _, err := app.SaveProfile(changed); err == nil {
			t.Fatalf("SaveProfile accepted a changed %s", name)
		}
	}
}

func TestAppReportsProfileStoreRecoveryState(t *testing.T) {
	path := filepath.Join(t.TempDir(), "profiles.json")
	app := newAppWithProfileStore(profile.NewStore(path))
	defer app.manager.Close()
	if status := app.ProfileStoreStatus(); status.State != "ok" {
		t.Fatalf("empty store status = %#v", status)
	}
	if err := os.WriteFile(path, []byte("{truncated"), 0o600); err != nil {
		t.Fatal(err)
	}
	if status := app.ProfileStoreStatus(); status.State != "corrupt" || status.Path != path {
		t.Fatalf("corrupt store status = %#v", status)
	}
	backup, err := app.RecoverCorruptProfileStore()
	if err != nil || backup == "" {
		t.Fatalf("recover = %q, %v", backup, err)
	}
	if status := app.ProfileStoreStatus(); status.State != "ok" {
		t.Fatalf("recovered store status = %#v", status)
	}
	if err := os.WriteFile(path, []byte(`{"version":99,"profiles":[]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if status := app.ProfileStoreStatus(); status.State != "unsupported" {
		t.Fatalf("newer store status = %#v", status)
	}
	if _, err := app.RecoverCorruptProfileStore(); err == nil {
		t.Fatal("a store from a newer version was reset")
	}
}

func TestAppExposesOnlyVerifiedGeometries(t *testing.T) {
	app := newAppWithProfileStore(profile.NewStore(filepath.Join(t.TempDir(), "profiles.json")))
	defer app.manager.Close()
	geometries := app.Geometries()
	want := []string{geometry.ANSI60USID, geometry.ANSITKLUSID, geometry.KinesisFreestyle}
	if len(geometries) != len(want) {
		t.Fatalf("geometries = %#v", geometries)
	}
	for index, template := range geometries {
		if template.ID != want[index] {
			t.Fatalf("geometry %d = %q, want %q", index, template.ID, want[index])
		}
		if _, err := template.ProfileGeometry(); err != nil {
			t.Fatal(err)
		}
	}
}

func TestAppCompilesVerifiedSplitGeometryProfile(t *testing.T) {
	app := newAppWithProfileStore(profile.NewStore(filepath.Join(t.TempDir(), "profiles.json")))
	defer app.manager.Close()
	draft, err := app.CreateProfile("device-1", "Split board", geometry.KinesisFreestyle)
	if err != nil {
		t.Fatal(err)
	}
	compiled, err := app.CompileProfile(draft.ID)
	if err != nil {
		t.Fatal(err)
	}
	// Repeated physical codes (two space keys, three home keys) share one
	// defsrc slot, because KMonad rejects duplicate source keycodes.
	unique := map[string]bool{}
	for _, sourceKey := range draft.Geometry.SourceKeys {
		unique[sourceKey] = true
	}
	if len(compiled.SourceMap) != len(unique) || len(unique) == len(draft.Geometry.SourceKeys) {
		t.Fatalf("source map = %d, unique source keys = %d, physical keys = %d", len(compiled.SourceMap), len(unique), len(draft.Geometry.SourceKeys))
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

func TestAppManagesSeveralProfilesPerKeyboard(t *testing.T) {
	app := newAppWithProfileStore(profile.NewStore(filepath.Join(t.TempDir(), "profiles.json")))
	defer app.manager.Close()
	first, err := app.CreateProfile("device-1", "Typing", geometry.ANSI60USID)
	if err != nil {
		t.Fatal(err)
	}
	first.Assignments = []profile.Assignment{{LayerID: "base", SourceKey: "caps", Behavior: profile.Behavior{Kind: "tap_hold", TimeoutMS: 200,
		Tap: &profile.Behavior{Kind: "key", Key: "esc"}, Hold: &profile.Behavior{Kind: "key", Key: "lctl"}}}}
	first, err = app.SaveProfile(first)
	if err != nil {
		t.Fatal(err)
	}
	copied, err := app.DuplicateProfile(first.ID, "Gaming")
	if err != nil {
		t.Fatal(err)
	}
	if copied.ID == first.ID || copied.DraftRevision != 1 || copied.ManagerConfigurationID != "" || len(copied.Assignments) != 1 || copied.Assignments[0].Behavior.Tap == first.Assignments[0].Behavior.Tap {
		t.Fatalf("duplicate = %#v", copied)
	}
	selected, err := app.SelectedProfiles()
	if err != nil || selected["device-1"] != copied.ID {
		t.Fatalf("new copy was not selected: %#v, %v", selected, err)
	}
	if err := app.SelectProfile("device-1", first.ID); err != nil {
		t.Fatal(err)
	}
	if err := app.SelectProfile("device-2", first.ID); err == nil {
		t.Fatal("selected a profile for another keyboard")
	}
	if err := app.DeleteProfile(first.ID, first.DraftRevision); err != nil {
		t.Fatal(err)
	}
	selected, err = app.SelectedProfiles()
	if err != nil || selected["device-1"] != copied.ID {
		t.Fatalf("deleting the selected profile did not reselect a sibling: %#v, %v", selected, err)
	}
	if err := app.DeleteProfile(copied.ID, copied.DraftRevision); err != nil {
		t.Fatal(err)
	}
	if selected, _ := app.SelectedProfiles(); len(selected) != 0 {
		t.Fatalf("selection survived its last profile: %#v", selected)
	}
}

func TestAppApplyingAnotherProfileUpdatesTheKeyboardsConfiguration(t *testing.T) {
	var methods []string
	var updateParams managerapi.ConfigurationWriteParams
	endpoint := testManager(t, func(method string, params json.RawMessage) string {
		methods = append(methods, method)
		switch method {
		case "session.hello":
			return `{"selected_version":1,"server_id":"server-1","manager_version":"test"}`
		case "manager.get":
			return `{"server_id":"server-1","capabilities":[{"name":"managed_configurations","available":true,"reason_code":"capability_available","reason":"ready"}]}`
		case "snapshot.get":
			return `{"state_revision":4,"event_cursor":{"server_id":"server-1","event_id":2,"state_revision":4},"devices":[],"configurations":[{"id":"cfg-1","name":"Typing","ownership":"managed","enabled":true,"device_id":"device-1","desired_revision":3,"active_revision":3,"runtime":{"phase":"running","reason_code":"runtime_running","reason":"running","connected":true,"healthy":true,"failure_count":0}}],"operations":[],"health":{"healthy":true,"reason_code":"manager_healthy","reason":"ok"}}`
		case "configuration.update":
			if err := json.Unmarshal(params, &updateParams); err != nil {
				t.Error(err)
			}
			return `{"operation":{"id":"op-1","kind":"apply","state":"succeeded","resource":{"kind":"configuration","id":"cfg-1"},"reason_code":"operation_succeeded","reason":"applied","configuration_revision":4}}`
		}
		t.Errorf("unexpected manager method %q", method)
		return `{}`
	})
	client := managerapi.New(managerapi.Options{Endpoint: endpoint, ClientName: "keyboardeer-test", ClientVersion: "test"})
	store := profile.NewStore(filepath.Join(t.TempDir(), "profiles.json"))
	app := &App{manager: client, profiles: store}
	defer app.manager.Close()
	typing, err := app.CreateProfile("device-1", "Typing", geometry.ANSI60USID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.SetApplyState(typing.ID, typing.DraftRevision, "cfg-1", nil); err != nil {
		t.Fatal(err)
	}
	gaming, err := app.DuplicateProfile(typing.ID, "Gaming")
	if err != nil {
		t.Fatal(err)
	}
	result, err := app.ApplyProfile(gaming.ID)
	if err != nil {
		t.Fatal(err)
	}
	if updateParams.ConfigurationID != "cfg-1" || updateParams.ExpectedRevision == nil || *updateParams.ExpectedRevision != 3 || updateParams.Name != "Gaming" {
		t.Fatalf("update params = %#v (methods %v)", updateParams, methods)
	}
	if result.Profile.ManagerConfigurationID != "cfg-1" {
		t.Fatalf("applied profile was not linked: %#v", result.Profile)
	}
	previous, err := app.profileByID(typing.ID)
	if err != nil || previous.ManagerConfigurationID != "" {
		t.Fatalf("previous profile kept the link: %#v, %v", previous, err)
	}
}

func TestAppDeletesManagedConfigurationButKeepsProfiles(t *testing.T) {
	var deleteParams managerapi.ConfigurationDeleteParams
	endpoint := testManager(t, func(method string, params json.RawMessage) string {
		switch method {
		case "session.hello":
			return `{"selected_version":1,"server_id":"server-1","manager_version":"test"}`
		case "manager.get":
			return `{"server_id":"server-1","capabilities":[{"name":"managed_configurations","available":true,"reason_code":"capability_available","reason":"ready"}]}`
		case "snapshot.get":
			return `{"state_revision":4,"event_cursor":{"server_id":"server-1","event_id":2,"state_revision":4},"devices":[],"configurations":[{"id":"cfg-1","name":"Typing","ownership":"managed","enabled":true,"device_id":"device-1","desired_revision":5,"active_revision":5,"runtime":{"phase":"running","reason_code":"runtime_running","reason":"running","connected":true,"healthy":true,"failure_count":0}}],"operations":[],"health":{"healthy":true,"reason_code":"manager_healthy","reason":"ok"}}`
		case "configuration.delete":
			if err := json.Unmarshal(params, &deleteParams); err != nil {
				t.Error(err)
			}
			return `{"operation":{"id":"op-2","kind":"lifecycle","state":"succeeded","resource":{"kind":"configuration","id":"cfg-1"},"reason_code":"operation_succeeded","reason":"configuration deleted and its KMonad process stopped"}}`
		}
		t.Errorf("unexpected manager method %q", method)
		return `{}`
	})
	client := managerapi.New(managerapi.Options{Endpoint: endpoint, ClientName: "keyboardeer-test", ClientVersion: "test"})
	store := profile.NewStore(filepath.Join(t.TempDir(), "profiles.json"))
	app := &App{manager: client, profiles: store}
	defer app.manager.Close()
	typing, err := app.CreateProfile("device-1", "Typing", geometry.ANSI60USID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.SetApplyState(typing.ID, typing.DraftRevision, "cfg-1", nil); err != nil {
		t.Fatal(err)
	}
	operation, err := app.DeleteConfiguration("cfg-1")
	if err != nil || operation.State != "succeeded" {
		t.Fatalf("delete = %#v, %v", operation, err)
	}
	if deleteParams.ConfigurationID != "cfg-1" || deleteParams.ExpectedRevision != 5 {
		t.Fatalf("delete params = %#v", deleteParams)
	}
	kept, err := app.profileByID(typing.ID)
	if err != nil || kept.ManagerConfigurationID != "" || kept.DraftRevision != typing.DraftRevision {
		t.Fatalf("profile after configuration delete = %#v, %v", kept, err)
	}
}

// testManager serves one JSON Lines connection, answering each request with
// the result returned by respond.
func testManager(t *testing.T, respond func(method string, params json.RawMessage) string) string {
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
		scanner.Buffer(make([]byte, 0, 64*1024), 1<<20)
		for scanner.Scan() {
			var request struct {
				ID     string          `json:"id"`
				Method string          `json:"method"`
				Params json.RawMessage `json:"params"`
			}
			if err := json.Unmarshal(scanner.Bytes(), &request); err != nil {
				t.Error(err)
				return
			}
			if _, err := fmt.Fprintf(connection, `{"type":"response","id":%q,"result":%s}`+"\n", request.ID, respond(request.Method, request.Params)); err != nil {
				t.Error(err)
				return
			}
		}
	}()
	t.Cleanup(connections.Wait)
	return path
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
