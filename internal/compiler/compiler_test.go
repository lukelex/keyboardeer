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
  \\
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

func TestCompileEmitsSharedSourceKeysOnce(t *testing.T) {
	input, err := profile.New("device-1", "Split", profile.Geometry{ID: "split", SourceKeys: []string{"a", "spc", "b", "spc"}})
	if err != nil {
		t.Fatal(err)
	}
	input.Assignments = []profile.Assignment{{LayerID: "base", SourceKey: "spc", Behavior: profile.Behavior{Kind: "key", Key: "ret"}}}
	result, err := Compile(input)
	if err != nil {
		t.Fatal(err)
	}
	want := "(defsrc\n  a\n  spc\n  b\n)\n\n(deflayer base\n  a\n  ret\n  b\n)\n"
	if result.Behavior != want {
		t.Fatalf("behavior =\n%s\nwant:\n%s", result.Behavior, want)
	}
	if len(result.SourceMap) != 3 || result.SourceMap[1].SourceKey != "spc" || !result.SourceMap[1].Explicit {
		t.Fatalf("source map = %#v", result.SourceMap)
	}
}

func TestCompileRejectsUnsupportedProfiles(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*profile.Profile)
		want   string
	}{
		{"base not first", func(p *profile.Profile) { p.Layers[0], p.Layers[1] = p.Layers[1], p.Layers[0] }, "base layer must be the first"},
		{"unknown key", func(p *profile.Profile) {
			p.Assignments[3].Behavior = profile.Behavior{Kind: "key", Key: "notakey"}
		}, "unsupported KMonad key"},
		{"unknown source key", func(p *profile.Profile) { p.Geometry.SourceKeys = append(p.Geometry.SourceKeys, "notakey") }, "invalid source key"},
		{"base pass-through", func(p *profile.Profile) {
			p.Assignments[0].Behavior = profile.Behavior{Kind: "transparent"}
		}, "no lower layer"},
		{"layer action in macro", func(p *profile.Profile) {
			p.Macros["paste"] = []profile.Behavior{{Kind: "hold_layer", Target: "nav"}}
		}, "key presses only"},
		{"pass-through alias", func(p *profile.Profile) { p.Aliases["copy"] = profile.Behavior{Kind: "transparent"} }, "cannot pass through"},
		{"nested tap/hold", func(p *profile.Profile) {
			inner := p.Assignments[1].Behavior
			p.Assignments[1].Behavior.Hold = &inner
		}, "cannot hold \"tap_hold\""},
		{"tap a hold-layer", func(p *profile.Profile) {
			p.Assignments[1].Behavior.Tap = &profile.Behavior{Kind: "hold_layer", Target: "nav"}
		}, "cannot tap \"hold_layer\""},
		{"excessive timeout", func(p *profile.Profile) { p.Assignments[1].Behavior.TimeoutMS = 60_000 }, "exceeds"},
		{"duplicate declaration name", func(p *profile.Profile) {
			p.Macros["copy"] = []profile.Behavior{{Kind: "key", Key: "c"}}
		}, "share the name"},
		{"duplicate layer ID", func(p *profile.Profile) { p.Layers = append(p.Layers, profile.Layer{ID: "nav", Name: "Other"}) }, "unique IDs"},
		{"duplicate assignment", func(p *profile.Profile) { p.Assignments = append(p.Assignments, p.Assignments[0]) }, "duplicate assignment"},
		{"unknown layer reference", func(p *profile.Profile) {
			p.Assignments[0].Behavior = profile.Behavior{Kind: "switch_layer", Target: "missing"}
		}, "unknown layer"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			input := fixture(t)
			test.mutate(&input)
			if _, err := Compile(input); err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("error = %v, want %q", err, test.want)
			}
		})
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
