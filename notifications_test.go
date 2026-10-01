package main

import (
	"strings"
	"testing"
)

type recordingNotifier struct{ summary, body string }

func (r *recordingNotifier) notify(summary, body string) error {
	r.summary, r.body = summary, body
	return nil
}

func TestNotifyTrimsEscapesAndRequiresASummary(t *testing.T) {
	recorder := &recordingNotifier{}
	app := &App{notifier: recorder}
	if err := app.Notify("  ", "body"); err == nil {
		t.Fatal("an empty summary must be rejected")
	}
	if err := app.Notify(" Mapping stopped ", "<b>Home row mods</b> & more"); err != nil {
		t.Fatal(err)
	}
	if recorder.summary != "Mapping stopped" || recorder.body != "&lt;b&gt;Home row mods&lt;/b&gt; &amp; more" {
		t.Fatalf("unexpected notification: %#v", recorder)
	}
	if err := app.Notify("Long", strings.Repeat("x", 900)); err != nil {
		t.Fatal(err)
	}
	if got := len([]rune(recorder.body)); got != maxNotificationText {
		t.Fatalf("body was not clipped: %d runes", got)
	}
}
