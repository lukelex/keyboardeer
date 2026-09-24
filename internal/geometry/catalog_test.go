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
		"grv", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "=", "bspc",
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

func TestEverySelectableGeometryHasAnExplicitValidVisualToSourceMap(t *testing.T) {
	for _, template := range List() {
		t.Run(template.ID, func(t *testing.T) {
			if err := template.Validate(); err != nil {
				t.Fatal(err)
			}
			geometry, err := template.ProfileGeometry()
			if err != nil {
				t.Fatal(err)
			}
			if len(template.Keys) != len(geometry.SourceKeys) {
				t.Fatalf("visual keys=%d, source keys=%d", len(template.Keys), len(geometry.SourceKeys))
			}
			seenIDs := map[string]bool{}
			lastRow := -1
			for index, drawnKey := range template.Keys {
				if drawnKey.ID == "" || drawnKey.SourceKey == "" || drawnKey.Label == "" {
					t.Fatalf("visual key %d is missing an ID, label, or source key: %#v", index, drawnKey)
				}
				if seenIDs[drawnKey.ID] {
					t.Fatalf("duplicate visual key ID %q", drawnKey.ID)
				}
				seenIDs[drawnKey.ID] = true
				if drawnKey.Row < lastRow {
					t.Fatalf("visual key rows are out of order at %q", drawnKey.ID)
				}
				lastRow = drawnKey.Row
				if drawnKey.SourceKey != geometry.SourceKeys[index] {
					t.Fatalf("visual key %q maps to %q at index %d, profile source is %q", drawnKey.ID, drawnKey.SourceKey, index, geometry.SourceKeys[index])
				}
			}
		})
	}
}

func TestLegacyANSI60ProfileMigrationMovesFirstKeyAndAssignmentsTogether(t *testing.T) {
	draft := profile.Profile{
		Geometry:    profile.Geometry{ID: LegacyANSI60USID, SourceKeys: []string{"esc", "a"}},
		Assignments: []profile.Assignment{{LayerID: "base", SourceKey: "esc", Behavior: profile.Behavior{Kind: "key", Key: "x"}}},
	}
	migrated := MigrateLegacyProfile(draft)
	if migrated.Geometry.ID != ANSI60USID || migrated.Geometry.SourceKeys[0] != "grv" || migrated.Assignments[0].SourceKey != "grv" {
		t.Fatalf("legacy map was not migrated consistently: %#v", migrated)
	}
	if draft.Geometry.ID != LegacyANSI60USID || draft.Geometry.SourceKeys[0] != "esc" {
		t.Fatal("migration mutated its input profile")
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
		{
			name:     "ISO 60%",
			template: ISO60US,
			want: `grv 1 2 3 4 5 6 7 8 9 0 - = bspc
tab q w e r t y u i o p [ ] ret
caps a s d f g h j k l ; ' \
lsft lsgt z x c v b n m , . / rsft
lctl lmet lalt spc ralt rmet cmp rctl`,
		},
		{
			name:     "ISO TKL",
			template: ISOTKLUS,
			want: `esc f1 f2 f3 f4 f5 f6 f7 f8 f9 f10 f11 f12 ssrq slck pause
grv 1 2 3 4 5 6 7 8 9 0 - = bspc ins home pgup
tab q w e r t y u i o p [ ] ret del end pgdn
caps a s d f g h j k l ; ' \
lsft 102d z x c v b n m , . / rsft up
lctl lmet lalt spc ralt rmet cmp rctl left down rght`,
		},
		{
			name:     "US ANSI 100%",
			template: ANSI100US,
			want: `esc f1 f2 f3 f4 f5 f6 f7 f8 f9 f10 f11 f12 ssrq slck pause
grv 1 2 3 4 5 6 7 8 9 0 - = bspc ins home pgup nlck kp/ kp* kp-
tab q w e r t y u i o p [ ] \ del end pgdn kp7 kp8 kp9 kp+
caps a s d f g h j k l ; ' ret kp4 kp5 kp6
lsft z x c v b n m , . / rsft up kp1 kp2 kp3 kprt
lctl lmet lalt spc ralt rmet cmp rctl left down rght kp0 kp.`,
		},
		{
			name:     "ISO 100%",
			template: ISO100US,
			want: `esc f1 f2 f3 f4 f5 f6 f7 f8 f9 f10 f11 f12 ssrq slck pause
grv 1 2 3 4 5 6 7 8 9 0 - = bspc ins home pgup nlck kp/ kp* kp-
tab q w e r t y u i o p [ ] ret del end pgdn kp7 kp8 kp9 kp+
caps a s d f g h j k l ; ' \ kp4 kp5 kp6
lsft 102d z x c v b n m , . / rsft up kp1 kp2 kp3 kprt
lctl lmet lalt spc ralt rmet cmp rctl left down rght kp0 kp.`,
		},
		{
			// thinkpad_x220_iso.kbd, US defsrc at the pinned commit.
			name:     "ISO Laptop 93",
			template: LaptopISO93,
			want: `esc mute vold volu prnt slck pause ins del home pgup
f1 f2 f3 f4 f5 f6 f7 f8 f9 f10 f11 f12 end pgdn
grv 1 2 3 4 5 6 7 8 9 0 - = bspc
tab q w e r t y u i o p [ ] ret
caps a s d f g h j k l ; ' \
lsft 102d z x c v b n m , . / rsft
wkup lctl lmet lalt spc ralt cmps rctl back up fwd
left down rght`,
		},
		{
			// thinkpad_T430_iso.kbd, US defsrc at the pinned commit: no 102nd
			// key despite the ISO filename, and no dedicated system-key row.
			name:     "ISO Laptop 87",
			template: LaptopISO87,
			want: `mute vold volu
esc f1 f2 f3 f4 f5 f6 f7 f8 f9 f10 f11 f12 home end ins del
grv 1 2 3 4 5 6 7 8 9 0 - = bspc
tab q w e r t y u i o p [ ] \
caps a s d f g h j k l ; ' ret
lsft z x c v b n m , . / rsft
wkup lctl lmet lalt spc ralt sys rctl pgdn up pgup
left down rght`,
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
	if !ok || second.Keys[0].Label != "` ~" {
		t.Fatalf("catalog template was mutated: %#v", second.Keys[0])
	}
}
