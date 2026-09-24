package geometry

import "testing"

func TestNormalizeKMonadTokensUsesConstructorIdentity(t *testing.T) {
	got, err := NormalizeKMonadTokens([]string{"lsgt", "102d", "cmp", "cmps", "kprt", "kpenter", "]", "rbrc", "\\", "bksl"})
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]bool{
		"Key102nd": true, "KeyCompose": true, "KeyKpEnter": true,
		"KeyRightBrace": true, "KeyBackslash": true,
	}
	if len(got) != len(want) {
		t.Fatalf("normalized constructors = %#v, want %#v", got, want)
	}
	for constructor := range want {
		if !got[constructor] {
			t.Errorf("normalized constructors missing %q", constructor)
		}
	}
}

func TestNormalizeKMonadTokensRejectsUnknownToken(t *testing.T) {
	if _, err := NormalizeKMonadTokens([]string{"kpenter", "kpen"}); err == nil {
		t.Fatal("unknown token was accepted")
	}
}
