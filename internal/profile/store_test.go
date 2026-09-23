package profile

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
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
	if err := store.Upsert(profile); err != nil {
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
	if err := store.Upsert(profile); err != nil {
		t.Fatal(err)
	}
	loaded, err = store.Load()
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Profiles[0].Name != "Renamed board" || !loaded.Profiles[0].CreatedAt.Equal(created) || !loaded.Profiles[0].UpdatedAt.After(created) || loaded.Profiles[0].DraftRevision != 2 {
		t.Fatalf("profile timestamps were not preserved/updated: %#v", loaded.Profiles[0])
	}
	if err := store.Delete(profile.ID); err != nil {
		t.Fatal(err)
	}
	loaded, err = store.Load()
	if err != nil || len(loaded.Profiles) != 0 {
		t.Fatalf("delete did not persist: %#v, %v", loaded, err)
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
	if string(persisted) == "" || !contains(string(persisted), `"version": 1`) {
		t.Fatalf("migration was not persisted: %s", persisted)
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
