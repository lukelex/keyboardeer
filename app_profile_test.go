package main

import (
	"path/filepath"
	"testing"

	"github.com/lukelex/keyboardeer/internal/geometry"
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
