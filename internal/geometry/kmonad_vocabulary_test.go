package geometry

import "testing"

// Pinned counts from kmonad's src/KMonad/Keyboard/Keycode.hs at
// 30b9705fb56059483969624d58cad077d5c62300: the Keycode ADT defines 510 Key*
// constructors, 106 of which carry alias spellings, 178 alias strings in total.
// If a regeneration changes these, the table no longer matches the pinned
// source: re-verify against that commit before updating the numbers.
const (
	pinnedKeycodeConstructors = 510
	pinnedAliasedKeycodes     = 106
	pinnedAliasSpellings      = 178
)

func TestVocabularyMatchesPinnedKMonadKeycodeSource(t *testing.T) {
	if len(kmonadKeycodes) != pinnedKeycodeConstructors {
		t.Fatalf("keycode constructors = %d, want %d", len(kmonadKeycodes), pinnedKeycodeConstructors)
	}
	aliased := 0
	spellings := 0
	seen := map[string]bool{}
	for _, keycode := range kmonadKeycodes {
		if len(keycode.Aliases) > 0 {
			aliased++
		}
		spellings += len(keycode.Aliases)
		for _, alias := range keycode.Aliases {
			if seen[alias] {
				t.Errorf("duplicate alias spelling %q", alias)
			}
			seen[alias] = true
		}
	}
	if aliased != pinnedAliasedKeycodes {
		t.Errorf("aliased keycodes = %d, want %d", aliased, pinnedAliasedKeycodes)
	}
	if spellings != pinnedAliasSpellings {
		t.Errorf("alias spellings = %d, want %d", spellings, pinnedAliasSpellings)
	}
}

// TestVocabularyResolvesVerifiedSpellings pins the token spellings detection
// evidence and the laptop conventions rely on to their canonical Keycode
// constructor.
func TestVocabularyResolvesVerifiedSpellings(t *testing.T) {
	cases := map[string]string{
		// Layout tokens shared with KMonad's published templates.
		"esc": "KeyEsc", "spc": "KeySpace", "ret": "KeyEnter", "grv": "KeyGrave",
		"bspc": "KeyBackspace", "caps": "KeyCapsLock", "kprt": "KeyKpEnter",
		// The 102nd key has three spellings across KMonad's templates; the
		// catalog accepts them all under one canonical constructor.
		"102d": "Key102nd", "lsgt": "Key102nd", "nubs": "Key102nd",
		"slck": "KeyScrollLock", "scrlck": "KeyScrollLock",
		"ssrq": "KeySysRq", "sys": "KeySysRq", "pause": "KeyPause",
		// Laptop-convention tokens verified against the pinned source.
		"mute": "KeyMute", "vold": "KeyVolumeDown", "volu": "KeyVolumeUp",
		"wkup": "KeyWakeUp", "cmps": "KeyCompose", "cmp": "KeyCompose",
		"back": "KeyBack", "fwd": "KeyForward", "prnt": "KeyPrint",
		// Assignment-only outputs the editor advertises.
		"break": "KeyBreak", "pp": "KeyPlayPause", "stopcd": "KeyStopCd",
		"kbdillumtoggle": "KeyKbdIllumToggle", "eject": "KeyEjectCd",
		"f13": "KeyF13", "f24": "KeyF24",
		// Constructor-form spellings the catalog emits verbatim.
		"KeyPaste": "KeyPaste", "KeyMenu": "KeyMenu",
	}
	for token, want := range cases {
		if got := kmonadKeycodeTokens[token]; got != want {
			t.Errorf("token %q resolves to %q, want %q", token, got, want)
		}
	}
}

// TestEveryCatalogSourceTokenIsAVerifiedKMonadKey guarantees the editor can
// never select a layout whose defsrc tokens KMonad would reject: every token in
// every catalog template must be one of the pinned vocabulary spellings.
func TestEveryCatalogSourceTokenIsAVerifiedKMonadKey(t *testing.T) {
	vocabulary := KnownKMonadKeys()
	for _, template := range List() {
		t.Run(template.ID, func(t *testing.T) {
			for _, key := range template.Keys {
				if !vocabulary[key.SourceKey] {
					t.Errorf("source key %q is not a verified KMonad token at the pinned commit", key.SourceKey)
				}
			}
		})
	}
}

// TestEveryOutputTokenIsAVerifiedKMonadKey keeps the advertised additional
// assignment keys inside the pinned vocabulary.
func TestEveryOutputTokenIsAVerifiedKMonadKey(t *testing.T) {
	vocabulary := KnownKMonadKeys()
	for token := range KnownOutputKeys() {
		if !vocabulary[token] {
			t.Errorf("output key %q is not a verified KMonad token at the pinned commit", token)
		}
	}
}
