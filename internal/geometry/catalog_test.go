package geometry

import (
	"reflect"
	"testing"

	"github.com/lukelex/keyboardeer/internal/profile"
)

func TestANSI60USMatchesDocumentedKMonadSourceOrder(t *testing.T) {
	geometry, err := ANSI60US.ProfileGeometry()
	if err != nil {
		t.Fatal(err)
	}
	want := []string{
		"esc", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "=", "bspc",
		"tab", "q", "w", "e", "r", "t", "y", "u", "i", "o", "p", "[", "]", "\\",
		"caps", "a", "s", "d", "f", "g", "h", "j", "k", "l", ";", "'", "ret",
		"lsft", "z", "x", "c", "v", "b", "n", "m", ",", ".", "/", "rsft",
		"lctl", "lmet", "lalt", "spc", "ralt", "rmet", "cmp", "rctl",
	}
	if !reflect.DeepEqual(geometry.SourceKeys, want) {
		t.Fatalf("source keys = %#v, want %#v", geometry.SourceKeys, want)
	}
	if len(geometry.SourceKeys) != 61 {
		t.Fatalf("source count = %d, want 61", len(geometry.SourceKeys))
	}
	fixture, err := profile.New("device-1", "ANSI fixture", geometry)
	if err != nil {
		t.Fatal(err)
	}
	if err := profile.Validate(fixture); err != nil {
		t.Fatal(err)
	}
}

func TestCatalogReturnsIndependentTemplates(t *testing.T) {
	first, ok := Lookup(ANSI60USID)
	if !ok {
		t.Fatal("ANSI 60 template was not found")
	}
	first.Keys[0].Label = "Changed"
	second, ok := Lookup(ANSI60USID)
	if !ok || second.Keys[0].Label != "Esc" {
		t.Fatalf("catalog template was mutated: %#v", second.Keys[0])
	}
}
