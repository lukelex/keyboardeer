package geometry

import (
	"reflect"
	"strings"
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

func TestAdditionalTemplatesMatchDocumentedKMonadSourceOrder(t *testing.T) {
	tests := []struct {
		name     string
		template Template
		want     string
	}{
		{
			name:     "US ANSI TKL",
			template: ANSIUSTKL,
			want: `esc f1 f2 f3 f4 f5 f6 f7 f8 f9 f10 f11 f12
grv 1 2 3 4 5 6 7 8 9 0 - = bspc ins home pgup
tab q w e r t y u i o p [ ] \ del end pgdn
caps a s d f g h j k l ; ' ret
lsft z x c v b n m , . / rsft up
lctl lmet lalt spc ralt rmet cmp rctl left down rght`,
		},
		{
			name:     "Kinesis Freestyle 2",
			template: KinesisFreestyle2,
			want: `esc f1 f2 f3 f4 f5 f6 f7 f8 f9 f10 f11 f12 prnt del pause
back fwd grv 1 2 3 4 5 6 7 8 9 0 - = bspc home
undo home tab q w e r t y u i o p [ ] \ end
cut del caps a s d f g h j k l ; ' ret pgup
copy KeyPaste lsft z x c v b n m , . / rsft up pgdn
home KeyMenu lctl lmet lalt spc spc ralt rctl left down rght`,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			geometry, err := test.template.ProfileGeometry()
			if err != nil {
				t.Fatal(err)
			}
			if want := strings.Fields(test.want); !reflect.DeepEqual(geometry.SourceKeys, want) {
				t.Fatalf("source keys = %#v, want %#v", geometry.SourceKeys, want)
			}
			if _, err := profile.New("device-1", test.name, geometry); err != nil {
				t.Fatalf("profile with documented geometry is invalid: %v", err)
			}
		})
	}
	freestyle, err := KinesisFreestyle2.ProfileGeometry()
	if err != nil {
		t.Fatal(err)
	}
	if count(freestyle.SourceKeys, "spc") != 2 || count(freestyle.SourceKeys, "home") != 3 {
		t.Fatalf("repeated shared source keys were not preserved: %#v", freestyle.SourceKeys)
	}
}

func count(values []string, target string) int {
	count := 0
	for _, value := range values {
		if value == target {
			count++
		}
	}
	return count
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
