// Package geometry provides explicitly selectable, source-key-verified editor
// layouts. A device's display name is never used to choose a layout.
package geometry

import (
	"fmt"
	"strings"

	"github.com/lukelex/keyboardeer/internal/profile"
)

const (
	ANSI60USID       = "us-ansi-60-v1"
	ANSITKLUSID      = "us-ansi-tkl-v1"
	KinesisFreestyle = "kinesis-freestyle2-v1"
)

// Key is one visible key in a layout. SourceKey is the KMonad defsrc token;
// Position and Width are layout data for a future visual renderer, not inferred
// from an input device.
type Key struct {
	ID        string  `json:"id"`
	Label     string  `json:"label"`
	SourceKey string  `json:"source_key"`
	Row       int     `json:"row"`
	Width     float64 `json:"width"`
	GapBefore float64 `json:"gap_before,omitempty"`
}

type Template struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Keys        []Key  `json:"keys"`
}

// ANSI60US is copied from KMonad's documented us_ansi_60 defsrc template.
// It deliberately has no device-specific defcfg data. See
// https://github.com/kmonad/kmonad/blob/master/keymap/tutorial.kbd
var ANSI60US = Template{
	ID:          ANSI60USID,
	Name:        "US ANSI 60%",
	Description: "Standard 61-key ANSI layout with the documented KMonad US ANSI 60% source order.",
	Keys: []Key{
		key("escape", "Esc", "esc", 0, 1),
		key("digit-1", "1", "1", 0, 1), key("digit-2", "2", "2", 0, 1), key("digit-3", "3", "3", 0, 1), key("digit-4", "4", "4", 0, 1), key("digit-5", "5", "5", 0, 1), key("digit-6", "6", "6", 0, 1), key("digit-7", "7", "7", 0, 1), key("digit-8", "8", "8", 0, 1), key("digit-9", "9", "9", 0, 1), key("digit-0", "0", "0", 0, 1), key("minus", "−", "-", 0, 1), key("equals", "=", "=", 0, 1), key("backspace", "Backspace", "bspc", 0, 2),
		key("tab", "Tab", "tab", 1, 1.5), key("q", "Q", "q", 1, 1), key("w", "W", "w", 1, 1), key("e", "E", "e", 1, 1), key("r", "R", "r", 1, 1), key("t", "T", "t", 1, 1), key("y", "Y", "y", 1, 1), key("u", "U", "u", 1, 1), key("i", "I", "i", 1, 1), key("o", "O", "o", 1, 1), key("p", "P", "p", 1, 1), key("left-bracket", "[", "[", 1, 1), key("right-bracket", "]", "]", 1, 1), key("backslash", "\\", "\\", 1, 1.5),
		key("caps-lock", "Caps", "caps", 2, 1.8), key("a", "A", "a", 2, 1), key("s", "S", "s", 2, 1), key("d", "D", "d", 2, 1), key("f", "F", "f", 2, 1), key("g", "G", "g", 2, 1), key("h", "H", "h", 2, 1), key("j", "J", "j", 2, 1), key("k", "K", "k", 2, 1), key("l", "L", "l", 2, 1), key("semicolon", ";", ";", 2, 1), key("apostrophe", "'", "'", 2, 1), key("enter", "Enter", "ret", 2, 2.2),
		key("left-shift", "Shift", "lsft", 3, 2.2), key("z", "Z", "z", 3, 1), key("x", "X", "x", 3, 1), key("c", "C", "c", 3, 1), key("v", "V", "v", 3, 1), key("b", "B", "b", 3, 1), key("n", "N", "n", 3, 1), key("m", "M", "m", 3, 1), key("comma", ",", ",", 3, 1), key("period", ".", ".", 3, 1), key("slash", "/", "/", 3, 1), key("right-shift", "Shift", "rsft", 3, 2.8),
		key("left-control", "Ctrl", "lctl", 4, 1.3), key("left-meta", "Super", "lmet", 4, 1.3), key("left-alt", "Alt", "lalt", 4, 1.3), key("space", "Space", "spc", 4, 6), key("right-alt", "Alt", "ralt", 4, 1), key("right-meta", "Super", "rmet", 4, 1), key("compose", "Menu", "cmp", 4, 1), key("right-control", "Ctrl", "rctl", 4, 1),
	},
}

// ANSIUS TKL is copied from KMonad's documented us_ansi_tkl template.
// https://github.com/kmonad/kmonad/blob/master/keymap/template/us_ansi_tkl.kbd
var ANSIUSTKL = templateFromRows(
	ANSITKLUSID,
	"US ANSI TKL",
	"Standard tenkeyless ANSI layout from KMonad’s documented source template.",
	[]layoutKey{
		layout("esc"), gap(2, "f1"), layout("f2"), layout("f3"), layout("f4"), gap(1, "f5"), layout("f6"), layout("f7"), layout("f8"), gap(1, "f9"), layout("f10"), layout("f11"), layout("f12"),
	},
	[]layoutKey{
		layout("grv"), layout("1"), layout("2"), layout("3"), layout("4"), layout("5"), layout("6"), layout("7"), layout("8"), layout("9"), layout("0"), layout("-"), layout("="), layout("bspc"), gap(1, "ins"), layout("home"), layout("pgup"),
	},
	[]layoutKey{
		layout("tab"), layout("q"), layout("w"), layout("e"), layout("r"), layout("t"), layout("y"), layout("u"), layout("i"), layout("o"), layout("p"), layout("["), layout("]"), layout("\\"), gap(1, "del"), layout("end"), layout("pgdn"),
	},
	[]layoutKey{
		layout("caps"), layout("a"), layout("s"), layout("d"), layout("f"), layout("g"), layout("h"), layout("j"), layout("k"), layout("l"), layout(";"), layout("'"), layout("ret"),
	},
	[]layoutKey{
		layout("lsft"), layout("z"), layout("x"), layout("c"), layout("v"), layout("b"), layout("n"), layout("m"), layout(","), layout("."), layout("/"), layout("rsft"), gap(1, "up"),
	},
	[]layoutKey{
		layout("lctl"), layout("lmet"), layout("lalt"), layout("spc"), layout("ralt"), layout("rmet"), layout("cmp"), layout("rctl"), gap(1, "left"), layout("down"), layout("rght"),
	},
)

// KinesisFreestyle2 is copied from KMonad's documented freestyle2 template.
// Repeated source codes are intentionally preserved: KMonad sees each pair as
// the same input code, so those physical positions share one editor binding.
// https://github.com/kmonad/kmonad/blob/master/keymap/template/freestyle2.kbd
var KinesisFreestyle2 = templateFromRows(
	KinesisFreestyle,
	"Kinesis Freestyle 2",
	"Split Kinesis Freestyle 2 layout from KMonad’s documented source template. Repeated physical codes share a binding.",
	[]layoutKey{
		layout("esc"), layout("f1"), layout("f2"), layout("f3"), layout("f4"), layout("f5"), layout("f6"), layout("f7"), gap(2, "f8"), layout("f9"), layout("f10"), layout("f11"), layout("f12"), gap(1, "prnt"), layout("del"), layout("pause"),
	},
	[]layoutKey{
		layout("back"), layout("fwd"), layout("grv"), layout("1"), layout("2"), layout("3"), layout("4"), layout("5"), layout("6"), gap(2, "7"), layout("8"), layout("9"), layout("0"), layout("-"), layout("="), layout("bspc"), gap(1, "home"),
	},
	[]layoutKey{
		layout("undo"), layout("home"), layout("tab"), layout("q"), layout("w"), layout("e"), layout("r"), layout("t"), gap(2, "y"), layout("u"), layout("i"), layout("o"), layout("p"), layout("["), layout("]"), layout("\\"), gap(1, "end"),
	},
	[]layoutKey{
		layout("cut"), layout("del"), layout("caps"), layout("a"), layout("s"), layout("d"), layout("f"), layout("g"), gap(2, "h"), layout("j"), layout("k"), layout("l"), layout(";"), layout("'"), gap(1, "ret"), layout("pgup"),
	},
	[]layoutKey{
		layout("copy"), layout("KeyPaste"), layout("lsft"), layout("z"), layout("x"), layout("c"), layout("v"), layout("b"), gap(2, "n"), layout("m"), layout(","), layout("."), layout("/"), layout("rsft"), gap(1, "up"), layout("pgdn"),
	},
	[]layoutKey{
		layout("home"), layout("KeyMenu"), layout("lctl"), layout("lmet"), layout("lalt"), layoutWidth("spc", 2.5), layoutGapWidth("spc", 2.5, 2), layout("ralt"), layout("rctl"), gap(1, "left"), layout("down"), layout("rght"),
	},
)

func key(id, label, source string, row int, width float64) Key {
	return Key{ID: id, Label: label, SourceKey: source, Row: row, Width: width}
}

type layoutKey struct {
	source    string
	width     float64
	gapBefore float64
}

func layout(source string) layoutKey { return layoutKey{source: source, width: standardWidth(source)} }
func layoutWidth(source string, width float64) layoutKey {
	return layoutKey{source: source, width: width}
}
func layoutGapWidth(source string, width, gapBefore float64) layoutKey {
	return layoutKey{source: source, width: width, gapBefore: gapBefore}
}
func gap(width float64, source string) layoutKey {
	key := layout(source)
	key.gapBefore = width
	return key
}

func templateFromRows(id, name, description string, rows ...[]layoutKey) Template {
	template := Template{ID: id, Name: name, Description: description}
	for rowIndex, row := range rows {
		for keyIndex, input := range row {
			template.Keys = append(template.Keys, Key{
				ID:        fmt.Sprintf("%s-%d-%d", id, rowIndex, keyIndex),
				Label:     keyLabel(input.source),
				SourceKey: input.source,
				Row:       rowIndex,
				Width:     input.width,
				GapBefore: input.gapBefore,
			})
		}
	}
	return template
}

func standardWidth(source string) float64 {
	switch source {
	case "bspc":
		return 2
	case "tab":
		return 1.5
	case "caps":
		return 1.8
	case "ret":
		return 2.2
	case "lsft":
		return 2.2
	case "rsft":
		return 2.8
	case "spc":
		return 6
	case "lctl", "lmet", "lalt":
		return 1.3
	default:
		return 1
	}
}

func keyLabel(source string) string {
	labels := map[string]string{
		"grv": "`", "bspc": "Backspace", "ret": "Enter", "lctl": "Ctrl", "rctl": "Ctrl", "lmet": "Super", "rmet": "Super", "lalt": "Alt", "ralt": "Alt", "lsft": "Shift", "rsft": "Shift", "spc": "Space", "cmp": "Menu", "prnt": "Print", "pgup": "PgUp", "pgdn": "PgDn", "rght": "Right", "back": "Back", "fwd": "Forward", "undo": "Undo", "cut": "Cut", "copy": "Copy", "KeyPaste": "Paste", "KeyMenu": "Menu",
	}
	if label, found := labels[source]; found {
		return label
	}
	if strings.HasPrefix(source, "f") && len(source) <= 3 {
		return strings.ToUpper(source)
	}
	return strings.ToUpper(source)
}

func List() []Template {
	return []Template{clone(ANSI60US), clone(ANSIUSTKL), clone(KinesisFreestyle2)}
}

// KnownSourceKeys is the union of KMonad key names used by verified layouts.
// The compiler accepts only these names, so the editor never emits an
// unverified keycode that KMonad would reject at preview time.
func KnownSourceKeys() map[string]bool {
	known := map[string]bool{}
	for _, template := range List() {
		for _, key := range template.Keys {
			known[key.SourceKey] = true
		}
	}
	return known
}

func Lookup(id string) (Template, bool) {
	switch id {
	case ANSI60USID:
		return clone(ANSI60US), true
	case ANSITKLUSID:
		return clone(ANSIUSTKL), true
	case KinesisFreestyle:
		return clone(KinesisFreestyle2), true
	}
	return Template{}, false
}

func (template Template) ProfileGeometry() (profile.Geometry, error) {
	if err := template.Validate(); err != nil {
		return profile.Geometry{}, err
	}
	sourceKeys := make([]string, len(template.Keys))
	for index, key := range template.Keys {
		sourceKeys[index] = key.SourceKey
	}
	return profile.Geometry{ID: template.ID, SourceKeys: sourceKeys}, nil
}

func (template Template) Validate() error {
	if template.ID == "" || template.Name == "" || len(template.Keys) == 0 {
		return fmt.Errorf("template ID, name, and keys are required")
	}
	ids := make(map[string]bool, len(template.Keys))
	for _, key := range template.Keys {
		if key.ID == "" || key.Label == "" || key.SourceKey == "" || key.Row < 0 || key.Width <= 0 || key.GapBefore < 0 {
			return fmt.Errorf("layout contains an incomplete key")
		}
		if ids[key.ID] {
			return fmt.Errorf("layout contains a duplicate key ID")
		}
		ids[key.ID] = true
	}
	return nil
}

func clone(template Template) Template {
	template.Keys = append([]Key(nil), template.Keys...)
	return template
}
