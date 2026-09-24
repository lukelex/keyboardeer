package compiler

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/lukelex/keyboardeer/internal/geometry"
	"github.com/lukelex/keyboardeer/internal/profile"
)

// testOnlyDefcfg is supplied by this conformance test, never by the compiler.
// Device representation belongs to kmonad-device-manager; /dev/null is enough
// for KMonad's dry-run parser and joiner, which do not open the device.
const testOnlyDefcfg = "(defcfg\n  input (device-file \"/dev/null\")\n  output (uinput-sink \"keyboardeer-conformance\"))\n"

// TestGeneratedBehaviorIsAcceptedByKMonad checks representative compiler
// output with a real KMonad dry-run. It is skipped when KMonad is absent so
// that the ordinary unit suite stays hermetic; set KEYBOARDEER_REQUIRE_KMONAD=1
// to make a missing binary a failure (for example, in a conformance CI job).
func TestGeneratedBehaviorIsAcceptedByKMonad(t *testing.T) {
	kmonad, err := exec.LookPath("kmonad")
	if err != nil {
		if os.Getenv("KEYBOARDEER_REQUIRE_KMONAD") == "1" {
			t.Fatal("kmonad is required but was not found in PATH")
		}
		t.Skip("kmonad is not installed; skipping KMonad conformance")
	}
	for _, test := range conformanceProfiles(t) {
		t.Run(test.name, func(t *testing.T) {
			result, err := Compile(test.profile)
			if err != nil {
				t.Fatal(err)
			}
			assertBehaviorOnly(t, result.Behavior)
			path := filepath.Join(t.TempDir(), "candidate.kbd")
			if err := os.WriteFile(path, []byte(testOnlyDefcfg+result.Behavior), 0o600); err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			defer cancel()
			output, err := exec.CommandContext(ctx, kmonad, "--dry-run", path).CombinedOutput()
			if err != nil {
				t.Fatalf("KMonad rejected generated behavior: %v\n%s\n--- behavior ---\n%s", err, output, result.Behavior)
			}
		})
	}
}

// TestCompilerNeverEmitsDeviceConfiguration runs without KMonad: the compiler
// output must stay behavior-only for every representative profile.
func TestCompilerNeverEmitsDeviceConfiguration(t *testing.T) {
	for _, test := range conformanceProfiles(t) {
		t.Run(test.name, func(t *testing.T) {
			result, err := Compile(test.profile)
			if err != nil {
				t.Fatal(err)
			}
			assertBehaviorOnly(t, result.Behavior)
		})
	}
}

type conformanceProfile struct {
	name    string
	profile profile.Profile
}

func conformanceProfiles(t *testing.T) []conformanceProfile {
	t.Helper()
	profiles := []conformanceProfile{}
	for _, template := range geometry.List() {
		layout, err := template.ProfileGeometry()
		if err != nil {
			t.Fatal(err)
		}
		// Every verified layout, unmodified: covers each supported key name in
		// defsrc, including shared physical codes and escaped characters.
		base, err := profile.New("device-1", template.Name, layout)
		if err != nil {
			t.Fatal(err)
		}
		profiles = append(profiles, conformanceProfile{name: template.ID + "/defaults", profile: base})
		profiles = append(profiles, conformanceProfile{name: template.ID + "/advanced", profile: advancedProfile(t, layout)})
	}
	profiles = append(profiles, conformanceProfile{name: "fixture", profile: fixture(t)})
	return profiles
}

// advancedProfile exercises every supported behavior kind on a real layout,
// and remaps every key on an overlay so each key name also appears as output.
func advancedProfile(t *testing.T, layout profile.Geometry) profile.Profile {
	t.Helper()
	value, err := profile.New("device-1", "Advanced", layout)
	if err != nil {
		t.Fatal(err)
	}
	keys := uniqueSourceKeys(layout.SourceKeys)
	value.Layers = append(value.Layers,
		profile.Layer{ID: "layer-nav", Name: "Navigation"},
		profile.Layer{ID: "layer-mirror", Name: "Mirror"},
	)
	value.Aliases["esc-nav"] = profile.Behavior{Kind: "tap_hold", TimeoutMS: 200,
		Tap: &profile.Behavior{Kind: "key", Key: "esc"}, Hold: &profile.Behavior{Kind: "hold_layer", Target: "layer-nav"}}
	value.Macros["type-ab"] = []profile.Behavior{{Kind: "key", Key: "a"}, {Kind: "key", Key: "b"}}
	value.Assignments = []profile.Assignment{
		{LayerID: "base", SourceKey: "caps", Behavior: profile.Behavior{Kind: "alias", Target: "esc-nav"}},
		{LayerID: "base", SourceKey: "a", Behavior: profile.Behavior{Kind: "tap_hold", TimeoutMS: 250,
			Tap: &profile.Behavior{Kind: "key", Key: "a"}, Hold: &profile.Behavior{Kind: "key", Key: "lsft"}}},
		{LayerID: "base", SourceKey: "b", Behavior: profile.Behavior{Kind: "tap_hold", TimeoutMS: 200,
			Tap: &profile.Behavior{Kind: "switch_layer", Target: "layer-mirror"}, Hold: &profile.Behavior{Kind: "key", Key: "lctl"}}},
		{LayerID: "base", SourceKey: "c", Behavior: profile.Behavior{Kind: "macro", Target: "type-ab"}},
		{LayerID: "base", SourceKey: "d", Behavior: profile.Behavior{Kind: "disabled"}},
		{LayerID: "layer-nav", SourceKey: "h", Behavior: profile.Behavior{Kind: "key", Key: "left"}},
		{LayerID: "layer-nav", SourceKey: "j", Behavior: profile.Behavior{Kind: "key", Key: "down"}},
		{LayerID: "layer-nav", SourceKey: "k", Behavior: profile.Behavior{Kind: "key", Key: "up"}},
		{LayerID: "layer-nav", SourceKey: "l", Behavior: profile.Behavior{Kind: "key", Key: "rght"}},
	}
	for index, key := range keys {
		behavior := profile.Behavior{Kind: "key", Key: keys[len(keys)-1-index]}
		if key == "esc" {
			behavior = profile.Behavior{Kind: "switch_layer", Target: "base"}
		}
		value.Assignments = append(value.Assignments, profile.Assignment{LayerID: "layer-mirror", SourceKey: key, Behavior: behavior})
	}
	return value
}

func assertBehaviorOnly(t *testing.T, behavior string) {
	t.Helper()
	for _, forbidden := range []string{"defcfg", "device-file", "uinput-sink", "iokit", "low-level-hook"} {
		if strings.Contains(behavior, forbidden) {
			t.Fatalf("compiler emitted device-specific form %q:\n%s", forbidden, behavior)
		}
	}
}
