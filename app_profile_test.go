package main

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

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
	want := []string{geometry.ANSI60USID, geometry.ANSITKLUSID, geometry.KinesisFreestyle, geometry.ISO60USID, geometry.ISOTKLUSID, geometry.ANSI100USID, geometry.ISO100USID, geometry.LaptopISO93ID, geometry.LaptopISO87ID}
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
	tempDir := t.TempDir()
	app := &App{
		manager: client, profiles: profile.NewStore(filepath.Join(tempDir, "profiles.json")),
		preferencesPath: filepath.Join(tempDir, "preferences.json"),
	}
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
	if !strings.HasPrefix(preview.CandidateDigest, "sha256:") || preview.Validation.CandidateDigest != preview.CandidateDigest || preview.ValidationRecovery == nil ||
		preview.ValidationRecovery.Checkpoint == nil || preview.ValidationRecovery.Checkpoint.CandidateDigest != preview.CandidateDigest {
		t.Fatalf("valid preview did not persist exact recovery provenance: %#v", preview)
	}
	profiles, err := app.Profiles()
	if err != nil || len(profiles) != 1 || profiles[0].DraftRevision != draft.DraftRevision || profiles[0].ValidationRecovery == nil || profiles[0].ValidationRecovery.Checkpoint == nil {
		t.Fatalf("validation checkpoint changed/did not persist with the draft: %#v, %v", profiles, err)
	}
}

func TestAppRejectsPreviewWithMismatchedCandidateDigest(t *testing.T) {
	endpoint := testPreviewManagerWithDigest(t, true)
	client := managerapi.New(managerapi.Options{Endpoint: endpoint, ClientName: "keyboardeer-test", ClientVersion: "test"})
	tempDir := t.TempDir()
	app := &App{
		manager: client, profiles: profile.NewStore(filepath.Join(tempDir, "profiles.json")),
		preferencesPath: filepath.Join(tempDir, "preferences.json"),
	}
	defer app.manager.Close()
	draft, err := app.CreateProfile("device-1", "Everyday", geometry.ANSI60USID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := app.PreviewProfile(draft.ID); err == nil || !strings.Contains(err.Error(), "candidate_digest_mismatch") {
		t.Fatalf("mismatched manager digest error = %v", err)
	}
	profiles, err := app.Profiles()
	if err != nil || len(profiles) != 1 || profiles[0].ValidationRecovery != nil {
		t.Fatalf("mismatched preview persisted recovery metadata: %#v, %v", profiles, err)
	}
}

func TestAppRejectsPreviewWhenManagerEnvironmentChanges(t *testing.T) {
	for _, test := range []struct {
		name         string
		revisions    []uint64
		capabilities []bool
	}{
		{name: "state revision", revisions: []uint64{9, 10}},
		{name: "capabilities", revisions: []uint64{9, 9}, capabilities: []bool{true, false}},
	} {
		t.Run(test.name, func(t *testing.T) {
			endpoint := testPreviewManagerWithOptions(t, false, test.revisions, test.capabilities)
			client := managerapi.New(managerapi.Options{Endpoint: endpoint, ClientName: "keyboardeer-test", ClientVersion: "test"})
			tempDir := t.TempDir()
			app := &App{
				manager: client, profiles: profile.NewStore(filepath.Join(tempDir, "profiles.json")),
				preferencesPath: filepath.Join(tempDir, "preferences.json"),
			}
			defer app.manager.Close()
			draft, err := app.CreateProfile("device-1", "Everyday", geometry.ANSI60USID)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := app.PreviewProfile(draft.ID); err == nil || !strings.Contains(err.Error(), "manager_state_changed") {
				t.Fatalf("manager environment change error = %v", err)
			}
			profiles, err := app.Profiles()
			if err != nil || len(profiles) != 1 || profiles[0].ValidationRecovery != nil {
				t.Fatalf("environment race persisted a validation checkpoint: %#v, %v", profiles, err)
			}
		})
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
	app := &App{manager: client, profiles: store, preferencesPath: filepath.Join(filepath.Dir(store.Path()), "preferences.json")}
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
	app := &App{manager: client, profiles: store, preferencesPath: filepath.Join(filepath.Dir(store.Path()), "preferences.json")}
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

const managedCapabilityReply = `{"server_id":"server-1","manager_version":"v1.1.0","capabilities":[{"name":"managed_configurations","available":true,"reason_code":"capability_available","reason":"ready"}]}`
const emptySnapshotReply = `{"state_revision":4,"event_cursor":{"server_id":"server-1","event_id":2,"state_revision":4},"devices":[],"configurations":[],"operations":[],"health":{"healthy":true,"reason_code":"manager_healthy","reason":"ok"}}`
const linkedSnapshotReply = `{"state_revision":4,"event_cursor":{"server_id":"server-1","event_id":2,"state_revision":4},"devices":[],"configurations":[{"id":"cfg-1","name":"Typing","ownership":"managed","enabled":true,"device_id":"device-1","desired_revision":3,"active_revision":3,"runtime":{"phase":"running","reason_code":"runtime_running","reason":"running","connected":true,"healthy":true,"failure_count":0}}],"operations":[],"health":{"healthy":true,"reason_code":"manager_healthy","reason":"ok"}}`
const createdOperationReply = `{"operation":{"id":"op-1","kind":"apply","state":"succeeded","resource":{"kind":"configuration","id":"cfg-1"},"reason_code":"operation_succeeded","reason":"configuration persisted and activation confirmed","configuration_revision":1}}`

func newApplyTestApp(t *testing.T, endpoint string) (*App, *profile.Store, profile.Profile) {
	t.Helper()
	client := managerapi.New(managerapi.Options{Endpoint: endpoint, ClientName: "keyboardeer-test", ClientVersion: "test", ReconnectInitial: time.Millisecond, ReconnectMaximum: time.Millisecond})
	store := profile.NewStore(filepath.Join(t.TempDir(), "profiles.json"))
	app := &App{manager: client, profiles: store, preferencesPath: filepath.Join(filepath.Dir(store.Path()), "preferences.json")}
	t.Cleanup(func() { _ = app.manager.Close() })
	draft, err := app.CreateProfile("device-1", "Typing", geometry.ANSI60USID)
	if err != nil {
		t.Fatal(err)
	}
	return app, store, draft
}

func TestAppReplaysUnconfirmedApplyWithTheSameIdempotencyKey(t *testing.T) {
	var keys []string
	var bodies []string
	endpoint := testManagerWithKeys(t, func(method string, params json.RawMessage, key string) string {
		switch method {
		case "session.hello":
			return `{"selected_version":1,"server_id":"server-1","manager_version":"test"}`
		case "manager.get":
			return managedCapabilityReply
		case "snapshot.get":
			return emptySnapshotReply
		case "configuration.create":
			keys = append(keys, key)
			bodies = append(bodies, string(params))
			if len(keys) == 1 {
				// The first response is lost: the manager may or may not have
				// accepted the mutation.
				return "ERROR temporary_unavailable"
			}
			return createdOperationReply
		}
		t.Errorf("unexpected manager method %q", method)
		return `{}`
	})
	app, _, draft := newApplyTestApp(t, endpoint)
	result, err := app.ApplyProfile(draft.ID)
	if err != nil || result.Uncertain || result.Operation.State != "succeeded" {
		t.Fatalf("apply = %#v, %v", result, err)
	}
	if len(keys) != 2 || keys[0] == "" || keys[0] != keys[1] || bodies[0] != bodies[1] {
		t.Fatalf("replay did not reuse the exact request: keys %v", keys)
	}
	if result.Profile.ApplyPending != nil || result.Profile.ManagerConfigurationID != "cfg-1" {
		t.Fatalf("applied profile = %#v", result.Profile)
	}
}

func TestAppKeepsUnconfirmedApplyAndResumesItLater(t *testing.T) {
	managerDown := true
	var keys []string
	endpoint := testManagerWithKeys(t, func(method string, _ json.RawMessage, key string) string {
		switch method {
		case "session.hello":
			return `{"selected_version":1,"server_id":"server-1","manager_version":"test"}`
		case "manager.get":
			return managedCapabilityReply
		case "snapshot.get":
			return emptySnapshotReply
		case "configuration.create":
			keys = append(keys, key)
			if managerDown {
				return "ERROR temporary_unavailable"
			}
			return createdOperationReply
		}
		t.Errorf("unexpected manager method %q", method)
		return `{}`
	})
	app, store, draft := newApplyTestApp(t, endpoint)
	result, err := app.ApplyProfile(draft.ID)
	if err != nil || !result.Uncertain {
		t.Fatalf("unconfirmed apply = %#v, %v", result, err)
	}
	// Simulate a GUI restart: a new App reads the persisted pending request.
	restartedManager := managerapi.New(managerapi.Options{
		Endpoint: endpoint, ClientName: "keyboardeer-test", ClientVersion: "test",
		ReconnectInitial: time.Millisecond, ReconnectMaximum: time.Millisecond,
	})
	t.Cleanup(func() { _ = restartedManager.Close() })
	restarted := &App{manager: restartedManager, profiles: profile.NewStore(store.Path()), preferencesPath: filepath.Join(filepath.Dir(store.Path()), "preferences.json")}
	pending, err := restarted.profileByID(draft.ID)
	if err != nil || pending.ApplyPending == nil || !pending.ApplyPending.Replayable() {
		t.Fatalf("pending apply was not persisted: %#v, %v", pending.ApplyPending, err)
	}
	if _, err := restarted.SaveProfile(pending); err == nil {
		t.Fatal("a draft with an unconfirmed apply was editable")
	}
	managerDown = false
	resumed, err := restarted.ResumeApply(draft.ID)
	if err != nil || resumed.Uncertain || resumed.Profile.ManagerConfigurationID != "cfg-1" || resumed.Profile.ApplyPending != nil {
		t.Fatalf("resume = %#v, %v", resumed, err)
	}
	for _, key := range keys {
		if key != keys[0] {
			t.Fatalf("resume used a different idempotency key: %v", keys)
		}
	}
}

func TestAppDoesNotRetryUncertainApplyOnUnknownManagerVersion(t *testing.T) {
	createCalls := 0
	endpoint := testManagerWithKeys(t, func(method string, _ json.RawMessage, _ string) string {
		switch method {
		case "session.hello":
			return `{"selected_version":1,"server_id":"server-1","manager_version":"test"}`
		case "manager.get":
			return `{"server_id":"server-1","manager_version":"dev","capabilities":[{"name":"managed_configurations","available":true,"reason_code":"capability_available","reason":"ready"}]}`
		case "snapshot.get":
			return emptySnapshotReply
		case "configuration.create":
			createCalls++
			return "ERROR temporary_unavailable"
		}
		t.Errorf("unexpected manager method %q", method)
		return `{}`
	})
	app, _, draft := newApplyTestApp(t, endpoint)
	result, err := app.ApplyProfile(draft.ID)
	if err != nil || !result.Uncertain || result.Profile.ApplyPending == nil || result.Profile.ApplyPending.IdempotencySupported {
		t.Fatalf("uncertain apply = %#v, %v", result, err)
	}
	if _, err := app.ResumeApply(draft.ID); err == nil {
		t.Fatal("unknown manager version was assumed to support idempotent replay")
	}
	if createCalls != 1 {
		t.Fatalf("uncertain mutation was sent %d times", createCalls)
	}
	resolved, err := app.DiscardPendingApply(draft.ID)
	if err != nil || resolved.ApplyPending != nil || resolved.LastApplyOperation == nil || resolved.LastApplyOperation.State != "unknown" {
		t.Fatalf("manual unknown-outcome resolution = %#v, %v", resolved, err)
	}
}

func TestAppFollowsRunningApplyUntilItFinishes(t *testing.T) {
	applyCalls := 0
	operationQueries := 0
	endpoint := testManagerWithKeys(t, func(method string, rawParams json.RawMessage, _ string) string {
		switch method {
		case "session.hello":
			return `{"selected_version":1,"server_id":"server-1","manager_version":"test"}`
		case "manager.get":
			return managedCapabilityReply
		case "snapshot.get":
			return emptySnapshotReply
		case "configuration.create":
			applyCalls++
			return `{"operation":{"id":"op-1","kind":"apply","state":"running","resource":{"kind":"configuration","id":"cfg-1"},"reason_code":"operation_running","reason":"mutation accepted by manager"}}`
		case "operation.get":
			operationQueries++
			var operationParams managerapi.OperationParams
			if err := json.Unmarshal(rawParams, &operationParams); err != nil {
				t.Error(err)
			} else if operationParams.OperationID != "op-1" {
				t.Errorf("queried unexpected operation %q", operationParams.OperationID)
			}
			return `{"operation":{"id":"op-1","kind":"apply","state":"rolled_back","resource":{"kind":"configuration","id":"cfg-1"},"reason_code":"runtime_rollback_succeeded","reason":"activation failed; the previous revision was restored","configuration_revision":2}}`
		}
		t.Errorf("unexpected manager method %q", method)
		return `{}`
	})
	app, store, draft := newApplyTestApp(t, endpoint)
	running, err := app.ApplyProfile(draft.ID)
	if err != nil || running.Operation.State != "running" || running.Profile.ApplyPending == nil || running.Profile.ApplyPending.OperationID != "op-1" {
		t.Fatalf("running apply = %#v, %v", running, err)
	}
	// Reopen the profile store and follow the accepted operation after a GUI
	// restart. The operation ID is queried; the mutation is not replayed.
	restartedManager := managerapi.New(managerapi.Options{
		Endpoint: endpoint, ClientName: "keyboardeer-test", ClientVersion: "test",
		ReconnectInitial: time.Millisecond, ReconnectMaximum: time.Millisecond,
	})
	t.Cleanup(func() { _ = restartedManager.Close() })
	restarted := &App{manager: restartedManager, profiles: profile.NewStore(store.Path()), preferencesPath: filepath.Join(filepath.Dir(store.Path()), "preferences.json")}
	finished, err := restarted.ResumeApply(draft.ID)
	if err != nil || finished.Operation.State != "rolled_back" || finished.Profile.ApplyPending != nil || finished.Profile.ManagerConfigurationID != "cfg-1" {
		t.Fatalf("finished apply = %#v, %v", finished, err)
	}
	if applyCalls != 1 || operationQueries != 1 {
		t.Fatalf("apply calls = %d, operation queries = %d", applyCalls, operationQueries)
	}
	if outcome := finished.Profile.LastApplyOperation; outcome == nil || outcome.State != "rolled_back" || outcome.ConfigurationRevision != 2 {
		t.Fatalf("rolled-back outcome was not persisted: %#v", finished.Profile.LastApplyOperation)
	}
	loaded, err := restarted.profileByID(draft.ID)
	if err != nil || loaded.LastApplyOperation == nil || loaded.LastApplyOperation.State != "rolled_back" {
		t.Fatalf("persisted outcome after reload = %#v, %v", loaded.LastApplyOperation, err)
	}
}

func TestAppPersistsRejectedCreateOutcomeWithoutAConfigurationLink(t *testing.T) {
	endpoint := testManagerWithKeys(t, func(method string, _ json.RawMessage, _ string) string {
		switch method {
		case "session.hello":
			return `{"selected_version":1,"server_id":"server-1","manager_version":"test"}`
		case "manager.get":
			return managedCapabilityReply
		case "snapshot.get":
			return emptySnapshotReply
		case "configuration.create":
			return `{"operation":{"id":"op-rejected","kind":"apply","state":"rejected","reason_code":"validation_rejected","reason":"the manager rejected this candidate"}}`
		}
		t.Errorf("unexpected manager method %q", method)
		return `{}`
	})
	app, store, draft := newApplyTestApp(t, endpoint)
	result, err := app.ApplyProfile(draft.ID)
	if err != nil || result.Operation.State != "rejected" || result.Profile.ManagerConfigurationID != "" {
		t.Fatalf("rejected apply = %#v, %v", result, err)
	}
	loaded, err := profile.NewStore(store.Path()).Load()
	if err != nil || len(loaded.Profiles) != 1 || loaded.Profiles[0].LastApplyOperation == nil || loaded.Profiles[0].LastApplyOperation.State != "rejected" {
		t.Fatalf("rejected outcome was not persisted: %#v, %v", loaded, err)
	}
}

func TestAppDoesNotReplayWhenAnAcceptedOperationIsNoLongerRetained(t *testing.T) {
	createCalls := 0
	endpoint := testManagerWithKeys(t, func(method string, _ json.RawMessage, _ string) string {
		switch method {
		case "session.hello":
			return `{"selected_version":1,"server_id":"server-1","manager_version":"test"}`
		case "manager.get":
			return managedCapabilityReply
		case "operation.get":
			return "ERROR not_found"
		case "configuration.create":
			createCalls++
			return createdOperationReply
		}
		t.Errorf("unexpected manager method %q", method)
		return `{}`
	})
	app, store, draft := newApplyTestApp(t, endpoint)
	request, err := json.Marshal(managerapi.ConfigurationWriteParams{
		Name:  "Typing",
		Model: managerapi.PreviewModel{DeviceID: draft.DeviceID, Behavior: "(defsrc caps)\n(deflayer base caps)"},
	})
	if err != nil {
		t.Fatal(err)
	}
	pending, err := store.SetApplyState(draft.ID, draft.DraftRevision, "", &profile.PendingApply{
		ManagerServerID:      "server-1",
		StartedAt:            time.Now().UTC(),
		IdempotencyKey:       "keyboardeer-accepted",
		IdempotencySupported: true,
		Method:               "configuration.create",
		Request:              request,
		OperationID:          "op-expired",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := app.ResumeApply(draft.ID); err == nil {
		t.Fatal("missing accepted operation was treated as safely replayable")
	}
	if createCalls != 0 {
		t.Fatalf("an accepted apply was replayed %d times", createCalls)
	}
	retained, err := app.profileByID(draft.ID)
	if err != nil || retained.ApplyPending == nil || retained.ApplyPending.OperationID != pending.ApplyPending.OperationID {
		t.Fatalf("unresolved operation was not preserved: %#v, %v", retained.ApplyPending, err)
	}
}

func TestAppDiscardsOnlyUnreplayablePendingApply(t *testing.T) {
	store := profile.NewStore(filepath.Join(t.TempDir(), "profiles.json"))
	app := newAppWithProfileStore(store)
	defer app.manager.Close()
	draft, err := app.CreateProfile("device-1", "Typing", geometry.ANSI60USID)
	if err != nil {
		t.Fatal(err)
	}
	legacy := &profile.PendingApply{ManagerServerID: "server-1", StartedAt: time.Now().UTC()}
	if _, err := store.SetApplyState(draft.ID, draft.DraftRevision, "", legacy); err != nil {
		t.Fatal(err)
	}
	cleared, err := app.DiscardPendingApply(draft.ID)
	if err != nil || cleared.ApplyPending != nil || cleared.LastApplyOperation == nil || cleared.LastApplyOperation.State != "unknown" {
		t.Fatalf("discard legacy = %#v, %v", cleared, err)
	}
	replayable := &profile.PendingApply{ManagerServerID: "server-1", StartedAt: time.Now().UTC(), IdempotencyKey: "key", IdempotencySupported: true, Method: "configuration.create", Request: json.RawMessage(`{}`)}
	if _, err := store.SetApplyState(draft.ID, draft.DraftRevision, "", replayable); err != nil {
		t.Fatal(err)
	}
	if _, err := app.DiscardPendingApply(draft.ID); err == nil {
		t.Fatal("a replayable pending apply was discarded")
	}
}

func TestAppReportsStaleRevisionForReview(t *testing.T) {
	endpoint := testManagerWithKeys(t, func(method string, _ json.RawMessage, _ string) string {
		switch method {
		case "session.hello":
			return `{"selected_version":1,"server_id":"server-1","manager_version":"test"}`
		case "manager.get":
			return managedCapabilityReply
		case "snapshot.get":
			return linkedSnapshotReply
		case "configuration.update":
			return "ERROR stale_revision"
		}
		t.Errorf("unexpected manager method %q", method)
		return `{}`
	})
	app, store, draft := newApplyTestApp(t, endpoint)
	if _, err := store.SetApplyState(draft.ID, draft.DraftRevision, "cfg-1", nil); err != nil {
		t.Fatal(err)
	}
	result, err := app.ApplyProfile(draft.ID)
	if err != nil || !result.Stale || result.Profile.ApplyPending != nil || result.Profile.ManagerConfigurationID != "cfg-1" {
		t.Fatalf("stale apply = %#v, %v", result, err)
	}
}

// testManager serves JSON Lines connections, answering each request with the
// result returned by respond. A reply of the form "ERROR code" is sent as a
// structured manager error instead of a result.
func testManager(t *testing.T, respond func(method string, params json.RawMessage) string) string {
	return testManagerWithKeys(t, func(method string, params json.RawMessage, _ string) string {
		return respond(method, params)
	})
}

func testManagerWithKeys(t *testing.T, respond func(method string, params json.RawMessage, idempotencyKey string) string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "api.sock")
	listener, err := net.Listen("unix", path)
	if err != nil {
		t.Fatal(err)
	}
	var mu sync.Mutex
	var connections sync.WaitGroup
	t.Cleanup(func() {
		_ = listener.Close()
		_ = os.Remove(path)
		connections.Wait()
	})
	connections.Add(1)
	go func() {
		defer connections.Done()
		for {
			connection, err := listener.Accept()
			if err != nil {
				return
			}
			connections.Add(1)
			go func() {
				defer connections.Done()
				defer connection.Close()
				scanner := bufio.NewScanner(connection)
				scanner.Buffer(make([]byte, 0, 64*1024), 1<<20)
				for scanner.Scan() {
					var request struct {
						ID             string          `json:"id"`
						Method         string          `json:"method"`
						Params         json.RawMessage `json:"params"`
						IdempotencyKey string          `json:"idempotency_key"`
					}
					if err := json.Unmarshal(scanner.Bytes(), &request); err != nil {
						t.Error(err)
						return
					}
					mu.Lock()
					reply := respond(request.Method, request.Params, request.IdempotencyKey)
					mu.Unlock()
					var frame string
					if code, isError := strings.CutPrefix(reply, "ERROR "); isError {
						frame = fmt.Sprintf(`{"type":"response","id":%q,"error":{"code":%q,"message":"test error"}}`, request.ID, code)
					} else {
						frame = fmt.Sprintf(`{"type":"response","id":%q,"result":%s}`, request.ID, reply)
					}
					if _, err := fmt.Fprintln(connection, frame); err != nil {
						return
					}
				}
			}()
		}
	}()
	return path
}

func testPreviewManager(t *testing.T) string {
	return testPreviewManagerWithOptions(t, false, nil, nil)
}

func testPreviewManagerWithDigest(t *testing.T, mismatchDigest bool) string {
	return testPreviewManagerWithOptions(t, mismatchDigest, nil, nil)
}

func testPreviewManagerWithOptions(t *testing.T, mismatchDigest bool, revisions []uint64, capabilityAvailability []bool) string {
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
		managerGetCount := 0
		for scanner.Scan() {
			var request struct {
				ID     string `json:"id"`
				Method string `json:"method"`
				Params struct {
					Model struct {
						Behavior string `json:"behavior"`
					} `json:"model"`
				} `json:"params"`
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
				managerGetCount++
				stateRevision, capabilityAvailable := uint64(9), true
				if len(revisions) >= managerGetCount {
					stateRevision = revisions[managerGetCount-1]
				}
				if len(capabilityAvailability) >= managerGetCount {
					capabilityAvailable = capabilityAvailability[managerGetCount-1]
				}
				reasonCode, reason := "capability_available", "ready"
				if !capabilityAvailable {
					reasonCode, reason = "capability_unavailable", "not ready"
				}
				result = fmt.Sprintf(`{"server_id":"server-1","state_revision":%d,"capabilities":[{"name":"candidate_validation","available":%t,"reason_code":%q,"reason":%q}]}`, stateRevision, capabilityAvailable, reasonCode, reason)
			case "validation.preview":
				digest := sha256.Sum256([]byte(request.Params.Model.Behavior))
				candidateDigest := "sha256:" + hex.EncodeToString(digest[:])
				if mismatchDigest {
					candidateDigest = "sha256:" + strings.Repeat("f", 64)
				}
				result = fmt.Sprintf(`{"validation":{"outcome":"valid","reason_code":"validation_succeeded","reason":"accepted","candidate_digest":%q,"diagnostics":[]}}`, candidateDigest)
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
	t.Cleanup(func() {
		_ = listener.Close()
		connections.Wait()
	})
	return path
}

func TestSanitizeFileName(t *testing.T) {
	cases := map[string]string{
		"Keychron Q1":        "Keychron Q1",
		"Slim/Split 75%":     "Slim-Split 75%",
		"A:b*c?d\"e<f>g|h":   "A-b-c-d-e-f-g-h",
		"  Trailing Dot. ":   "Trailing Dot",
		"/":                  "keyboard-profile",
		"Unicode ⌨ Keyboard": "Unicode ⌨ Keyboard",
	}
	for input, want := range cases {
		if got := sanitizeFileName(input); got != want {
			t.Errorf("sanitizeFileName(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestSyncedProfileFileNameUsesKeyboardName(t *testing.T) {
	app := newAppWithProfileStore(profile.NewStore(filepath.Join(t.TempDir(), "profiles.json")))
	defer app.manager.Close()
	app.lastWorkspace = &managerapi.Workspace{Snapshot: &managerapi.Snapshot{
		Devices: []managerapi.Device{{ID: "device-1", DisplayName: "Keychron Q1"}},
	}}
	draft, err := app.CreateProfile("device-1", "Everyday", geometry.ANSI60USID)
	if err != nil {
		t.Fatal(err)
	}
	// A keyboard with a single profile is named after the keyboard.
	name, err := app.syncedProfileFileName(draft)
	if err != nil {
		t.Fatal(err)
	}
	if name != "Keychron Q1.kbdprofile.json" {
		t.Fatalf("single-profile name = %q", name)
	}
	// A second profile on the same keyboard is disambiguated by its name.
	copied, err := app.DuplicateProfile(draft.ID, "Writing")
	if err != nil {
		t.Fatal(err)
	}
	firstName, err := app.syncedProfileFileName(draft)
	if err != nil {
		t.Fatal(err)
	}
	secondName, err := app.syncedProfileFileName(copied)
	if err != nil {
		t.Fatal(err)
	}
	if firstName != "Keychron Q1 - Everyday.kbdprofile.json" || secondName != "Keychron Q1 - Writing.kbdprofile.json" {
		t.Fatalf("multi-profile names = %q, %q", firstName, secondName)
	}
	// The fallback for an unknown device is the profile name.
	draft.DeviceID = "unknown-device"
	fallback, err := app.syncedProfileFileName(draft)
	if err != nil {
		t.Fatal(err)
	}
	if fallback != "Everyday.kbdprofile.json" {
		t.Fatalf("unexpected fallback name %q", fallback)
	}
}

func TestAppImportProfileFromPathSeededByLaunchArgument(t *testing.T) {
	app := newAppWithProfileStore(profile.NewStore(filepath.Join(t.TempDir(), "profiles.json")))
	defer app.manager.Close()
	original, err := app.CreateProfile("device-1", "Everyday", geometry.ANSI60USID)
	if err != nil {
		t.Fatal(err)
	}
	exported, err := profile.Export(original)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "Shared Everyday.kbdprofile.json")
	if err := os.WriteFile(path, exported, 0o600); err != nil {
		t.Fatal(err)
	}

	// A plain launch has no pending file.
	if got := app.PendingKbdProfileFile(); got != "" {
		t.Fatalf("unexpected pending file %q", got)
	}

	// The OS-launch flow seeds the pending file; importing consumes it.
	app.SetPendingKbdProfileFile(path)
	if got := app.PendingKbdProfileFile(); got != path {
		t.Fatalf("pending file = %q, want %q", got, path)
	}
	imported, err := app.ImportProfileFromPath(path, "device-1")
	if err != nil {
		t.Fatal(err)
	}
	if imported.ID == original.ID || imported.DraftRevision != 1 {
		t.Fatalf("imported draft = %#v", imported)
	}
	if got := app.PendingKbdProfileFile(); got != "" {
		t.Fatalf("pending file not cleared after import: %q", got)
	}

	// Dismissing the open-file notice clears the pending file without importing.
	app.SetPendingKbdProfileFile(path)
	app.ClearPendingKbdProfileFile()
	if got := app.PendingKbdProfileFile(); got != "" {
		t.Fatalf("pending file not cleared on dismiss: %q", got)
	}

	// A file that is not a *.kbdprofile.json cannot be imported.
	badPath := filepath.Join(t.TempDir(), "notes.txt")
	if err := os.WriteFile(badPath, []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := app.ImportProfileFromPath(badPath, "device-1"); err == nil {
		t.Fatal("ImportProfileFromPath accepted a non-profile file")
	}
}

func TestProfileSyncWritesAndDeletesKeyboardNamedFiles(t *testing.T) {
	folder := filepath.Join(t.TempDir(), "sync")
	if err := os.MkdirAll(folder, 0o700); err != nil {
		t.Fatal(err)
	}
	app := newAppWithProfileStore(profile.NewStore(filepath.Join(t.TempDir(), "profiles.json")))
	defer app.manager.Close()
	app.lastWorkspace = &managerapi.Workspace{Snapshot: &managerapi.Snapshot{
		Devices: []managerapi.Device{{ID: "device-1", DisplayName: "Framework keyboard"}},
	}}
	if err := app.SavePreferences(Preferences{ProfileSyncEnabled: true, ProfileSyncFolder: folder}); err != nil {
		t.Fatal(err)
	}
	draft, err := app.CreateProfile("device-1", "Laptop", geometry.ANSI60USID)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(folder, "Framework keyboard.kbdprofile.json")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("synced file not written: %v", err)
	}
	if err := app.DeleteProfile(draft.ID, draft.DraftRevision); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("synced file not removed after profile deletion: %v", err)
	}
}
