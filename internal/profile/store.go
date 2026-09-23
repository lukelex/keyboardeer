package profile

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type Store struct {
	path string
	mu   sync.Mutex
}

func NewStore(path string) *Store { return &Store{path: path} }
func DefaultPath() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(base, "keyboardeer", "profiles.json"), nil
}
func (s *Store) Path() string { return s.path }

type CorruptStoreError struct {
	Path string
	Err  error
}

func (e *CorruptStoreError) Error() string { return "profile store is corrupt: " + e.Path }
func (e *CorruptStoreError) Unwrap() error { return e.Err }

// UnsupportedStoreVersionError deliberately does not classify a store as
// corrupt: resetting an intact store written by a newer KeyboarDeer risks data
// loss and must never be an automatic recovery path.
type UnsupportedStoreVersionError struct {
	Path    string
	Version int
}

func (e *UnsupportedStoreVersionError) Error() string {
	return fmt.Sprintf("profile store %q uses unsupported version %d", e.Path, e.Version)
}

type StaleDraftError struct {
	ProfileID string
	Expected  uint64
	Actual    uint64
}

func (e *StaleDraftError) Error() string {
	return fmt.Sprintf("profile %q is stale: expected draft revision %d, current revision %d", e.ProfileID, e.Expected, e.Actual)
}

func (s *Store) Load() (StoreData, error) { s.mu.Lock(); defer s.mu.Unlock(); return s.load() }
func (s *Store) load() (StoreData, error) {
	data, err := os.ReadFile(s.path)
	if errors.Is(err, fs.ErrNotExist) {
		return StoreData{Version: StoreVersion, Profiles: []Profile{}}, nil
	}
	if err != nil {
		return StoreData{}, err
	}
	var store StoreData
	if err := json.Unmarshal(data, &store); err != nil {
		return StoreData{}, &CorruptStoreError{Path: s.path, Err: err}
	}
	migrated := store.Version == 0
	if migrated {
		store.Version = StoreVersion
		for index := range store.Profiles {
			if store.Profiles[index].DraftRevision == 0 {
				store.Profiles[index].DraftRevision = 1
			}
		}
	}
	if store.Version != StoreVersion {
		return StoreData{}, &UnsupportedStoreVersionError{Path: s.path, Version: store.Version}
	}
	if err := ValidateStore(store); err != nil {
		return StoreData{}, &CorruptStoreError{Path: s.path, Err: err}
	}
	if migrated {
		if err := s.save(store); err != nil {
			return StoreData{}, err
		}
	}
	return store, nil
}
func (s *Store) Save(data StoreData) error { s.mu.Lock(); defer s.mu.Unlock(); return s.save(data) }
func (s *Store) save(data StoreData) error {
	if err := ValidateStore(data); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return err
	}
	encoded, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return err
	}
	encoded = append(encoded, '\n')
	temporary, err := os.CreateTemp(filepath.Dir(s.path), ".profiles-*")
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
	if err := os.Rename(name, s.path); err != nil {
		return err
	}
	dir, err := os.Open(filepath.Dir(s.path))
	if err != nil {
		return err
	}
	defer dir.Close()
	return dir.Sync()
}
func (s *Store) Upsert(profile Profile) (Profile, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	store, err := s.load()
	if err != nil {
		return Profile{}, err
	}
	profile.UpdatedAt = time.Now().UTC()
	found := false
	for i := range store.Profiles {
		if store.Profiles[i].ID == profile.ID {
			if profile.DraftRevision != store.Profiles[i].DraftRevision {
				return Profile{}, &StaleDraftError{ProfileID: profile.ID, Expected: profile.DraftRevision, Actual: store.Profiles[i].DraftRevision}
			}
			profile.CreatedAt = store.Profiles[i].CreatedAt
			if store.Profiles[i].DraftRevision == ^uint64(0) {
				return Profile{}, fmt.Errorf("profile %q draft revision overflow", profile.ID)
			}
			profile.DraftRevision = store.Profiles[i].DraftRevision + 1
			store.Profiles[i] = profile
			found = true
		}
	}
	if !found {
		profile.DraftRevision = 1
		store.Profiles = append(store.Profiles, profile)
	}
	if err := s.save(store); err != nil {
		return Profile{}, err
	}
	return profile, nil
}

// SetApplyState changes manager-lifecycle metadata without advancing the draft
// revision: the editable profile model has not changed. The expected revision
// still protects this update from attaching lifecycle state to a stale draft.
func (s *Store) SetApplyState(id string, expectedDraftRevision uint64, configurationID string, pending *PendingApply) (Profile, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := s.load()
	if err != nil {
		return Profile{}, err
	}
	for index := range data.Profiles {
		profile := &data.Profiles[index]
		if profile.ID != id {
			continue
		}
		if profile.DraftRevision != expectedDraftRevision {
			return Profile{}, &StaleDraftError{ProfileID: id, Expected: expectedDraftRevision, Actual: profile.DraftRevision}
		}
		if configurationID != "" {
			profile.ManagerConfigurationID = configurationID
		}
		profile.ApplyPending = pending
		profile.UpdatedAt = time.Now().UTC()
		if err := s.save(data); err != nil {
			return Profile{}, err
		}
		return *profile, nil
	}
	return Profile{}, fmt.Errorf("profile %q does not exist", id)
}

func (s *Store) Delete(id string, expectedDraftRevision uint64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	store, err := s.load()
	if err != nil {
		return err
	}
	next := store.Profiles[:0]
	found := false
	for _, profile := range store.Profiles {
		if profile.ID != id {
			next = append(next, profile)
			continue
		}
		found = true
		if profile.DraftRevision != expectedDraftRevision {
			return &StaleDraftError{ProfileID: id, Expected: expectedDraftRevision, Actual: profile.DraftRevision}
		}
	}
	if !found {
		return fmt.Errorf("profile %q does not exist", id)
	}
	store.Profiles = next
	return s.save(store)
}
func (s *Store) BackupAndReset() (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := s.load(); err == nil {
		return "", fmt.Errorf("profile store is not corrupt")
	} else {
		var corrupt *CorruptStoreError
		if !errors.As(err, &corrupt) {
			return "", err
		}
	}
	backup := fmt.Sprintf("%s.corrupt-%d", s.path, time.Now().UTC().UnixNano())
	if err := os.Rename(s.path, backup); err != nil {
		return "", err
	}
	return backup, s.save(StoreData{Version: StoreVersion, Profiles: []Profile{}})
}
