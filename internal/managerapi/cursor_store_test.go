package managerapi

import (
	"path/filepath"
	"testing"
)

func TestEventCursorStorePersistsAndDoesNotRegressSameServer(t *testing.T) {
	store := NewEventCursorStore(filepath.Join(t.TempDir(), "event-cursor.json"))
	if err := store.Save(EventCursor{ServerID: "server-1", EventID: 7, StateRevision: 12}); err != nil {
		t.Fatal(err)
	}
	if err := store.Save(EventCursor{ServerID: "server-1", EventID: 4, StateRevision: 9}); err != nil {
		t.Fatal(err)
	}
	cursor, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	if cursor.ServerID != "server-1" || cursor.EventID != 7 || cursor.StateRevision != 12 {
		t.Fatalf("cursor regressed: %#v", cursor)
	}
	if err := store.Save(EventCursor{ServerID: "server-2", EventID: 1, StateRevision: 1}); err != nil {
		t.Fatal(err)
	}
	cursor, err = store.Load()
	if err != nil || cursor.ServerID != "server-2" || cursor.EventID != 1 {
		t.Fatalf("server restart cursor = %#v, %v", cursor, err)
	}
}
