package profile

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func testProfile(t *testing.T, name string) Profile {
	t.Helper()
	profile, err := New("device-1", name, Geometry{ID: "fixture-ansi", SourceKeys: []string{"esc", "a"}})
	if err != nil {
		t.Fatal(err)
	}
	profile.Assignments = []Assignment{{LayerID: "base", SourceKey: "a", Behavior: Behavior{Kind: "key", Key: "b"}}}
	return profile
}

func TestStoreCreatesLoadsAndUpdatesProfile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested", "profiles.json")
	store := NewStore(path)
	initial, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	if initial.Version != StoreVersion || len(initial.Profiles) != 0 {
		t.Fatalf("unexpected empty store: %#v", initial)
	}

	profile := testProfile(t, "First board")
	if _, err := store.Upsert(profile); err != nil {
		t.Fatal(err)
	}
	metadata, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if metadata.Mode().Perm()&0o077 != 0 {
		t.Fatalf("profile store permissions = %o, want owner-only", metadata.Mode().Perm())
	}
	loaded, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	if len(loaded.Profiles) != 1 || loaded.Profiles[0].Name != "First board" {
		t.Fatalf("unexpected profiles: %#v", loaded.Profiles)
	}
	created := loaded.Profiles[0].CreatedAt
	profile = loaded.Profiles[0]
	profile.Name = "Renamed board"
	profile.UpdatedAt = time.Time{}
	if _, err := store.Upsert(profile); err != nil {
		t.Fatal(err)
	}
	loaded, err = store.Load()
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Profiles[0].Name != "Renamed board" || !loaded.Profiles[0].CreatedAt.Equal(created) || !loaded.Profiles[0].UpdatedAt.After(created) || loaded.Profiles[0].DraftRevision != 2 {
		t.Fatalf("profile timestamps were not preserved/updated: %#v", loaded.Profiles[0])
	}
	if err := store.Delete(profile.ID, loaded.Profiles[0].DraftRevision); err != nil {
		t.Fatal(err)
	}
	loaded, err = store.Load()
	if err != nil || len(loaded.Profiles) != 0 {
		t.Fatalf("delete did not persist: %#v, %v", loaded, err)
	}
}

func TestStoreRejectsStaleDraftWrites(t *testing.T) {
	store := NewStore(filepath.Join(t.TempDir(), "profiles.json"))
	profile := testProfile(t, "First")
	saved, err := store.Upsert(profile)
	if err != nil {
		t.Fatal(err)
	}
	updated := saved
	updated.Name = "Newer"
	updated, err = store.Upsert(updated)
	if err != nil {
		t.Fatal(err)
	}
	saved.Name = "Stale"
	_, err = store.Upsert(saved)
	var stale *StaleDraftError
	if !errors.As(err, &stale) || stale.Actual != updated.DraftRevision {
		t.Fatalf("stale save error = %v", err)
	}
}

func TestStoreRecordsApplyStateWithoutChangingDraftRevision(t *testing.T) {
	store := NewStore(filepath.Join(t.TempDir(), "profiles.json"))
	saved, err := store.Upsert(testProfile(t, "First"))
	if err != nil {
		t.Fatal(err)
	}
	pendingAt := time.Now().UTC().Round(0)
	pending, err := store.SetApplyState(saved.ID, saved.DraftRevision, "", &PendingApply{ManagerServerID: "server-1", StartedAt: pendingAt})
	if err != nil {
		t.Fatal(err)
	}
	if pending.DraftRevision != saved.DraftRevision || pending.ApplyPending == nil || pending.ApplyPending.ManagerServerID != "server-1" {
		t.Fatalf("unexpected pending apply state: %#v", pending)
	}
	linked, err := store.SetApplyOutcome(saved.ID, saved.DraftRevision, "cfg-1", ApplyOutcome{
		ID: "op-1", Kind: "apply", State: "succeeded", ReasonCode: "operation_succeeded",
		Reason: "configuration persisted and activation confirmed", ConfigurationRevision: 4,
	})
	if err != nil {
		t.Fatal(err)
	}
	if linked.DraftRevision != saved.DraftRevision || linked.ApplyPending != nil || linked.ManagerConfigurationID != "cfg-1" || linked.LastApplyOperation == nil || linked.LastApplyOperation.ID != "op-1" {
		t.Fatalf("unexpected linked state: %#v", linked)
	}
	reopened, err := NewStore(store.Path()).Load()
	if err != nil || reopened.Profiles[0].LastApplyOperation == nil || reopened.Profiles[0].LastApplyOperation.ConfigurationRevision != 4 {
		t.Fatalf("apply outcome was not persisted: %#v, %v", reopened, err)
	}
}

func TestStorePersistsValidationCheckpointWithoutAdvancingDraftRevision(t *testing.T) {
	store := NewStore(filepath.Join(t.TempDir(), "profiles.json"))
	saved, err := store.Upsert(testProfile(t, "Recovery"))
	if err != nil {
		t.Fatal(err)
	}
	saved.ValidationRecovery = &ValidationRecovery{PreEdit: []AssignmentFallback{{
		GeometryID: saved.Geometry.ID, LayerID: "base", SourceKey: "a", HadAssignment: true,
		Behavior: Behavior{Kind: "key", Key: "esc"},
	}}}
	saved, err = store.Upsert(saved)
	if err != nil {
		t.Fatal(err)
	}
	// Checkpoint requests are made from Profile(), which reloads the JSON
	// representation. Use that normalized form here too (empty maps tagged
	// omitempty come back as nil).
	data, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	saved = data.Profiles[0]
	checkpoint := ValidationCheckpoint{
		DraftRevision: saved.DraftRevision, ManagerServerID: "server-1",
		CandidateDigest: "sha256:fixture", Geometry: saved.Geometry,
		Layers: saved.Layers, Assignments: saved.Assignments,
		Aliases: saved.Aliases, Macros: saved.Macros,
	}
	recorded, err := store.SetValidationCheckpoint(saved.ID, saved.DraftRevision, checkpoint)
	if err != nil {
		t.Fatal(err)
	}
	if recorded.DraftRevision != saved.DraftRevision || recorded.ValidationRecovery == nil ||
		recorded.ValidationRecovery.Checkpoint == nil || recorded.ValidationRecovery.Checkpoint.CandidateDigest != checkpoint.CandidateDigest ||
		len(recorded.ValidationRecovery.PreEdit) != 0 {
		t.Fatalf("unexpected validation recovery metadata: %#v", recorded.ValidationRecovery)
	}
	reopened, err := NewStore(store.Path()).Load()
	if err != nil || len(reopened.Profiles) != 1 || reopened.Profiles[0].ValidationRecovery == nil || reopened.Profiles[0].ValidationRecovery.Checkpoint == nil {
		t.Fatalf("validation checkpoint was not persisted: %#v, %v", reopened, err)
	}

	stale := checkpoint
	stale.DraftRevision--
	if _, err := store.SetValidationCheckpoint(saved.ID, saved.DraftRevision-1, stale); err == nil {
		t.Fatal("stale validation checkpoint was accepted")
	}
	wrongState := checkpoint
	wrongState.Assignments = nil
	if _, err := store.SetValidationCheckpoint(saved.ID, saved.DraftRevision, wrongState); err == nil {
		t.Fatal("checkpoint state that differed from the saved draft was accepted")
	}
}

func TestStoreMigratesUnversionedSchema(t *testing.T) {
	path := filepath.Join(t.TempDir(), "profiles.json")
	profile := testProfile(t, "Migrated")
	if err := os.WriteFile(path, []byte(`{"profiles":[`+mustJSON(t, profile)+`]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	store := NewStore(path)
	loaded, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Version != StoreVersion || len(loaded.Profiles) != 1 {
		t.Fatalf("migration result: %#v", loaded)
	}
	persisted, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(string(persisted), "{\n  \"version\": "+strconv.Itoa(StoreVersion)+",") {
		t.Fatalf("migration was not persisted: %s", persisted)
	}
	if loaded.Selected["device-1"] != profile.ID {
		t.Fatalf("migration did not select the only profile: %#v", loaded.Selected)
	}
	backup, err := os.ReadFile(path + ".v0-backup")
	if err != nil || string(backup) != `{"profiles":[`+mustJSON(t, profile)+`]}` {
		t.Fatalf("pre-migration backup = %s, %v", backup, err)
	}
}

func TestStoreMigratesLegacyKinesisGeometry(t *testing.T) {
	path := filepath.Join(t.TempDir(), "profiles.json")
	candidate := testProfile(t, "Legacy split")
	candidate.Geometry.ID = "kinesis-freestyle2-v1"
	data := StoreData{Version: 3, Profiles: []Profile{candidate}, Selected: map[string]string{"device-1": candidate.ID}}
	encoded, err := json.Marshal(data)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, encoded, 0o600); err != nil {
		t.Fatal(err)
	}

	loaded, err := NewStore(path).Load()
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Version != StoreVersion || loaded.Profiles[0].Geometry.ID != "split-94-v1" {
		t.Fatalf("legacy geometry migration = %#v", loaded)
	}
}

func TestStoreMigratesLegacyANSI60SourceMapping(t *testing.T) {
	path := filepath.Join(t.TempDir(), "profiles.json")
	draft := testProfile(t, "Legacy ANSI 60")
	draft.Geometry = Geometry{ID: "us-ansi-60-v1", SourceKeys: []string{"esc", "a"}}
	draft.Assignments = []Assignment{{LayerID: "base", SourceKey: "esc", Behavior: Behavior{Kind: "key", Key: "x"}}}
	document := `{"version":2,"profiles":[` + mustJSON(t, draft) + `]}`
	if err := os.WriteFile(path, []byte(document), 0o600); err != nil {
		t.Fatal(err)
	}
	loaded, err := NewStore(path).Load()
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Version != StoreVersion || len(loaded.Profiles) != 1 {
		t.Fatalf("store migration result: %#v", loaded)
	}
	migrated := loaded.Profiles[0]
	if migrated.Geometry.ID != "us-ansi-60-v2" || migrated.Geometry.SourceKeys[0] != "grv" || migrated.Assignments[0].SourceKey != "grv" {
		t.Fatalf("legacy ANSI 60 profile was not migrated consistently: %#v", migrated)
	}
	if backup, err := os.ReadFile(path + ".v2-backup"); err != nil || string(backup) != document {
		t.Fatalf("pre-migration backup = %s, %v", backup, err)
	}
}

func TestStoreMigratesVersionOneSelectingTheLinkedProfile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "profiles.json")
	older := testProfile(t, "Older")
	older.CreatedAt = time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	linked := testProfile(t, "Linked")
	linked.CreatedAt = older.CreatedAt.Add(time.Hour)
	linked.ManagerConfigurationID = "cfg-1"
	other := testProfile(t, "Other keyboard")
	other.DeviceID = "device-2"
	document := `{"version":1,"profiles":[` + mustJSON(t, older) + `,` + mustJSON(t, linked) + `,` + mustJSON(t, other) + `]}`
	if err := os.WriteFile(path, []byte(document), 0o600); err != nil {
		t.Fatal(err)
	}
	loaded, err := NewStore(path).Load()
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Version != StoreVersion || loaded.Selected["device-1"] != linked.ID || loaded.Selected["device-2"] != other.ID {
		t.Fatalf("migrated selection = %#v", loaded.Selected)
	}
	if backup, err := os.ReadFile(path + ".v1-backup"); err != nil || string(backup) != document {
		t.Fatalf("v1 backup = %s, %v", backup, err)
	}
}

func TestStoreMovesConfigurationLinkBetweenProfiles(t *testing.T) {
	store := NewStore(filepath.Join(t.TempDir(), "profiles.json"))
	first, err := store.Upsert(testProfile(t, "First"))
	if err != nil {
		t.Fatal(err)
	}
	second, err := store.Upsert(testProfile(t, "Second"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.SetApplyState(first.ID, first.DraftRevision, "cfg-1", nil); err != nil {
		t.Fatal(err)
	}
	if _, err := store.SetApplyState(second.ID, second.DraftRevision, "cfg-1", nil); err != nil {
		t.Fatal(err)
	}
	data, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	if data.find(first.ID).ManagerConfigurationID != "" || data.find(second.ID).ManagerConfigurationID != "cfg-1" {
		t.Fatalf("link was not moved: %#v", data.Profiles)
	}
	data.Profiles[0].ManagerConfigurationID = "cfg-1"
	if err := ValidateStore(data); err == nil {
		t.Fatal("two profiles linking one configuration were accepted")
	}
}

func TestStoreReopensAfterInterruptedWrite(t *testing.T) {
	path := filepath.Join(t.TempDir(), "profiles.json")
	store := NewStore(path)
	saved, err := store.Upsert(testProfile(t, "Survivor"))
	if err != nil {
		t.Fatal(err)
	}
	// A crash between writing the temporary file and renaming it leaves an
	// orphan beside the intact store. It must not affect the next launch.
	if err := os.WriteFile(filepath.Join(filepath.Dir(path), ".profiles-crashed"), []byte(`{"version":1,"profiles":[`), 0o600); err != nil {
		t.Fatal(err)
	}
	reopened, err := NewStore(path).Load()
	if err != nil {
		t.Fatal(err)
	}
	if len(reopened.Profiles) != 1 || reopened.Profiles[0].ID != saved.ID || reopened.Profiles[0].DraftRevision != saved.DraftRevision {
		t.Fatalf("reopened store = %#v", reopened)
	}
}

func TestValidateEnforcesSchemaRules(t *testing.T) {
	for name, mutate := range map[string]func(*Profile){
		"base not first":     func(p *Profile) { p.Layers = []Layer{{ID: "nav", Name: "Nav"}, {ID: "base", Name: "Base"}} },
		"invalid layer ID":   func(p *Profile) { p.Layers = append(p.Layers, Layer{ID: "nav layer", Name: "Nav"}) },
		"invalid alias name": func(p *Profile) { p.Aliases = map[string]Behavior{"has space": {Kind: "key", Key: "a"}} },
		"empty macro":        func(p *Profile) { p.Macros = map[string][]Behavior{"empty": {}} },
		"long name":          func(p *Profile) { p.Name = strings.Repeat("x", 81) },
		"unreplayable pending apply": func(p *Profile) {
			p.ApplyPending = &PendingApply{ManagerServerID: "server-1", StartedAt: time.Now(), IdempotencyKey: "key"}
		},
	} {
		value := testProfile(t, "Schema")
		mutate(&value)
		if err := Validate(value); err == nil {
			t.Fatalf("Validate accepted %s", name)
		}
	}
}

func TestStoreRejectsInvalidAndRecoversCorruptData(t *testing.T) {
	path := filepath.Join(t.TempDir(), "profiles.json")
	if err := os.WriteFile(path, []byte(`not json`), 0o600); err != nil {
		t.Fatal(err)
	}
	store := NewStore(path)
	_, err := store.Load()
	var corrupt *CorruptStoreError
	if !errors.As(err, &corrupt) {
		t.Fatalf("Load error = %v, want CorruptStoreError", err)
	}
	backup, err := store.BackupAndReset()
	if err != nil {
		t.Fatal(err)
	}
	if data, err := os.ReadFile(backup); err != nil || string(data) != "not json" {
		t.Fatalf("backup = %q, %v", data, err)
	}
	loaded, err := store.Load()
	if err != nil || loaded.Version != StoreVersion || len(loaded.Profiles) != 0 {
		t.Fatalf("recovered store = %#v, %v", loaded, err)
	}
}

func TestStoreDoesNotOfferResetForNewerSchema(t *testing.T) {
	path := filepath.Join(t.TempDir(), "profiles.json")
	if err := os.WriteFile(path, []byte(`{"version":99,"profiles":[]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	store := NewStore(path)
	_, err := store.Load()
	var unsupported *UnsupportedStoreVersionError
	if !errors.As(err, &unsupported) {
		t.Fatalf("Load error = %v, want UnsupportedStoreVersionError", err)
	}
	if _, err := store.BackupAndReset(); err == nil {
		t.Fatal("BackupAndReset accepted a newer valid schema")
	}
}

func TestValidateRejectsUnknownReferencesAndDuplicateAssignments(t *testing.T) {
	profile := testProfile(t, "Invalid")
	profile.Assignments = append(profile.Assignments, Assignment{LayerID: "base", SourceKey: "a", Behavior: Behavior{Kind: "key", Key: "c"}})
	if err := Validate(profile); err == nil {
		t.Fatal("Validate accepted duplicate assignment")
	}
	profile.Assignments = []Assignment{{LayerID: "base", SourceKey: "a", Behavior: Behavior{Kind: "hold_layer", Target: "missing"}}}
	if err := Validate(profile); err == nil {
		t.Fatal("Validate accepted unknown layer")
	}
}

func mustJSON(t *testing.T, value any) string {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func contains(value, substring string) bool { return strings.Contains(value, substring) }
