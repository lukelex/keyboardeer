// Package geometry provides explicitly selectable, source-key-verified editor
// layouts. A device's display name is never used to choose a layout.
package geometry

import (
	"fmt"

	"github.com/lukelex/keyboardeer/internal/profile"
)

const ANSI60USID = "us-ansi-60-v1"

// Key is one visible key in a layout. SourceKey is the KMonad defsrc token;
// Position and Width are layout data for a future visual renderer, not inferred
// from an input device.
type Key struct {
	ID        string  `json:"id"`
	Label     string  `json:"label"`
	SourceKey string  `json:"source_key"`
	Row       int     `json:"row"`
	Width     float64 `json:"width"`
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

func key(id, label, source string, row int, width float64) Key {
	return Key{ID: id, Label: label, SourceKey: source, Row: row, Width: width}
}

func List() []Template { return []Template{clone(ANSI60US)} }

func Lookup(id string) (Template, bool) {
	if id == ANSI60USID {
		return clone(ANSI60US), true
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
	sources := make(map[string]bool, len(template.Keys))
	for _, key := range template.Keys {
		if key.ID == "" || key.Label == "" || key.SourceKey == "" || key.Row < 0 || key.Width <= 0 {
			return fmt.Errorf("layout contains an incomplete key")
		}
		if ids[key.ID] || sources[key.SourceKey] {
			return fmt.Errorf("layout contains a duplicate key ID or source key")
		}
		ids[key.ID] = true
		sources[key.SourceKey] = true
	}
	return nil
}

func clone(template Template) Template {
	template.Keys = append([]Key(nil), template.Keys...)
	return template
}
