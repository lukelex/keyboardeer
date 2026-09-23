package main

import "testing"

func TestInfo(t *testing.T) {
	info := NewApp().Info()
	if info.Name != "KeyboarDeer" || info.Version == "" {
		t.Fatalf("unexpected app info: %#v", info)
	}
}
