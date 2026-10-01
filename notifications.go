package main

import (
	"fmt"
	"strings"

	"github.com/godbus/dbus/v5"
)

// desktopNotifier sends freedesktop.org desktop notifications. The interface
// lets tests run without a D-Bus session.
type desktopNotifier interface {
	notify(summary, body string) error
}

// dbusNotifier calls org.freedesktop.Notifications on the session bus, the
// standard notification service of Linux desktops.
type dbusNotifier struct{}

func (dbusNotifier) notify(summary, body string) error {
	connection, err := dbus.SessionBus()
	if err != nil {
		return fmt.Errorf("desktop notifications are unavailable: %w", err)
	}
	call := connection.Object(
		"org.freedesktop.Notifications",
		"/org/freedesktop/Notifications",
	).Call(
		"org.freedesktop.Notifications.Notify", 0,
		"KeyboarDeer",             // app_name
		uint32(0),                 // replaces_id
		"keyboardeer",             // app_icon
		summary,                   // summary
		body,                      // body
		[]string{},                // actions
		map[string]dbus.Variant{}, // hints
		int32(-1),                 // expire_timeout: server default
	)
	return call.Err
}

const maxNotificationText = 500

// Notify shows a desktop notification. The frontend uses it for runtime
// problems while the window is not focused; text is trimmed and never
// interpreted as markup.
func (a *App) Notify(summary, body string) error {
	summary = strings.TrimSpace(summary)
	if summary == "" {
		return fmt.Errorf("a notification needs a summary")
	}
	notifier := a.notifier
	if notifier == nil {
		notifier = dbusNotifier{}
	}
	return notifier.notify(clip(summary), escapeNotificationMarkup(clip(body)))
}

func clip(text string) string {
	runes := []rune(strings.TrimSpace(text))
	if len(runes) <= maxNotificationText {
		return string(runes)
	}
	return string(runes[:maxNotificationText-1]) + "…"
}

// Notification servers may render a small HTML subset in the body.
func escapeNotificationMarkup(text string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;").Replace(text)
}
