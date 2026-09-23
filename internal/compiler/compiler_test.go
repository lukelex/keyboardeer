package compiler

import (
	"strings"
	"testing"

	"github.com/lukelex/keyboardeer/internal/profile"
)

func fixture(t *testing.T) profile.Profile {
	t.Helper()
	value, err := profile.New("device-1", "Fixture", profile.Geometry{ID: "fixture", SourceKeys: []string{"a", "b", "\\"}})
	if err != nil {
		t.Fatal(err)
	}
	value.Layers = append(value.Layers, profile.Layer{ID: "nav", Name: "Navigation"})
	value.Aliases["copy"] = profile.Behavior{Kind: "key", Key: "c"}
	value.Macros["paste"] = []profile.Behavior{{Kind: "key", Key: "v"}, {Kind: "key", Key: "ret"}}
	value.Assignments = []profile.Assignment{
		{LayerID: "base", SourceKey: "a", Behavior: profile.Behavior{Kind: "alias", Target: "copy"}},
		{LayerID: "base", SourceKey: "b", Behavior: profile.Behavior{Kind: "tap_hold", TimeoutMS: 200, Tap: &profile.Behavior{Kind: "key", Key: "esc"}, Hold: &profile.Behavior{Kind: "hold_layer", Target: "nav"}}},
		{LayerID: "nav", SourceKey: "a", Behavior: profile.Behavior{Kind: "macro", Target: "paste"}},
		{LayerID: "nav", SourceKey: "b", Behavior: profile.Behavior{Kind: "disabled"}},
	}
	return value
}

func TestCompileIsDeterministicAndMapsEverySlot(t *testing.T) {
	input := fixture(t)
	first, err := Compile(input)
	if err != nil {
		t.Fatal(err)
	}
	second, err := Compile(input)
	if err != nil {
		t.Fatal(err)
	}
	if first.Behavior != second.Behavior || len(first.SourceMap) != 6 {
		t.Fatalf("compiler was nondeterministic or map incomplete: %#v", first)
	}
	want := `(defsrc
  a
  b
  \
)

(defalias
  copy c
  paste #(v ret)
)

(deflayer base
  @copy
  (tap-hold 200 esc (layer-toggle nav))
  \\
)

(deflayer nav
  @paste
  XX
  _
)
`
	if first.Behavior != want {
		t.Fatalf("behavior =\n%s\nwant:\n%s", first.Behavior, want)
	}
	entry := first.SourceMap[1]
	if entry.LayerID != "base" || entry.SourceKey != "b" || !entry.Explicit || entry.Span.StartLine != 14 || entry.Span.StartColumn != 3 {
		t.Fatalf("unexpected source map entry: %#v", entry)
	}
	if first.SourceMap[5].Explicit {
		t.Fatalf("unassigned overlay key should be transparent default: %#v", first.SourceMap[5])
	}
}

func TestCompileRejectsInjectionAndCycles(t *testing.T) {
	input := fixture(t)
	input.Assignments[0].Behavior = profile.Behavior{Kind: "key", Key: "a) (defcfg"}
	if _, err := Compile(input); err == nil || !strings.Contains(err.Error(), "unsafe KMonad key token") {
		t.Fatalf("injection error = %v", err)
	}
	input = fixture(t)
	input.Aliases["copy"] = profile.Behavior{Kind: "macro", Target: "paste"}
	input.Macros["paste"] = []profile.Behavior{{Kind: "alias", Target: "copy"}}
	if _, err := Compile(input); err == nil || !strings.Contains(err.Error(), "cyclic") {
		t.Fatalf("cycle error = %v", err)
	}
}
