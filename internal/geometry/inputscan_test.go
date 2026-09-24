package geometry

import "testing"

func TestNormalizeInputScanTokensUsesManagerCanonicalAliases(t *testing.T) {
	tokens := []string{"102nd", "kpenter", "numlock", "scrolllock", "sysrq", "compose", "right"}
	got, err := NormalizeInputScanTokens(tokens)
	if err != nil {
		t.Fatal(err)
	}
	for _, token := range []string{"102d", "kprt", "nlck", "slck", "ssrq", "cmp", "rght"} {
		constructor, ok := KMonadConstructor(token)
		if !ok || !got[constructor] {
			t.Errorf("manager token alias %q was not normalized", token)
		}
	}
}

func TestMatchInputScanRanksExactCatalogLayout(t *testing.T) {
	template, ok := Lookup(ANSI60USID)
	if !ok {
		t.Fatal("ANSI 60% template is missing")
	}
	tokens := make([]string, 0, len(template.Keys))
	for _, key := range template.Keys {
		tokens = append(tokens, key.SourceKey)
	}
	matches, err := MatchInputScan(tokens)
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) == 0 || matches[0].GeometryID != ANSI60USID || matches[0].Kind != ScanExact {
		t.Fatalf("top match = %#v", matches)
	}
}

func TestMatchInputScanRejectsUnknownManagerToken(t *testing.T) {
	if _, err := MatchInputScan([]string{"a", "not-a-kmonad-token"}); err == nil {
		t.Fatal("unknown manager token was silently accepted")
	}
}
