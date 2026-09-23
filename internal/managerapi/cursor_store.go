package managerapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sync"
)

const eventCursorStoreVersion = 1

// EventCursorStore persists only the opaque manager replay cursor. It contains
// no device names, configuration content, or GUI profile data.
type EventCursorStore struct {
	path string
	mu   sync.Mutex
}

type eventCursorStoreData struct {
	Version int         `json:"version"`
	Cursor  EventCursor `json:"cursor"`
}

func NewEventCursorStore(path string) *EventCursorStore { return &EventCursorStore{path: path} }
func (s *EventCursorStore) Path() string                { return s.path }

func (s *EventCursorStore) Load() (EventCursor, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.load()
}

func (s *EventCursorStore) load() (EventCursor, error) {
	data, err := os.ReadFile(s.path)
	if errors.Is(err, fs.ErrNotExist) {
		return EventCursor{}, nil
	}
	if err != nil {
		return EventCursor{}, err
	}
	var stored eventCursorStoreData
	if err := json.Unmarshal(data, &stored); err != nil {
		return EventCursor{}, fmt.Errorf("decode event cursor store: %w", err)
	}
	if stored.Version != eventCursorStoreVersion {
		return EventCursor{}, fmt.Errorf("unsupported event cursor store version %d", stored.Version)
	}
	return stored.Cursor, nil
}

// Save never regresses a cursor for the same manager server. A later snapshot
// or replay can safely overwrite the cursor after a manager restart because the
// server ID is a new opaque identity.
func (s *EventCursorStore) Save(cursor EventCursor) error {
	if cursor.ServerID == "" {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	previous, err := s.load()
	if err != nil {
		return err
	}
	if previous.ServerID == cursor.ServerID && previous.EventID > cursor.EventID {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return err
	}
	encoded, err := json.Marshal(eventCursorStoreData{Version: eventCursorStoreVersion, Cursor: cursor})
	if err != nil {
		return err
	}
	encoded = append(encoded, '\n')
	temporary, err := os.CreateTemp(filepath.Dir(s.path), ".event-cursor-*")
	if err != nil {
		return err
	}
	name := temporary.Name()
	defer os.Remove(name)
	if err = temporary.Chmod(0o600); err == nil {
		_, err = temporary.Write(encoded)
	}
	if err == nil {
		err = temporary.Sync()
	}
	if closeErr := temporary.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	return os.Rename(name, s.path)
}
