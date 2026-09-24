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
	if store.Version > StoreVersion || store.Version < 0 {
		return StoreData{}, &UnsupportedStoreVersionError{Path: s.path, Version: store.Version}
	}
	original := store.Version
	for store.Version < StoreVersion {
		migrate := migrations[store.Version]
		if migrate == nil {
			return StoreData{}, &UnsupportedStoreVersionError{Path: s.path, Version: original}
		}
		migrate(&store)
		store.Version++
	}
	if store.Profiles == nil {
		store.Profiles = []Profile{}
	}
	if err := ValidateStore(store); err != nil {
		return StoreData{}, &CorruptStoreError{Path: s.path, Err: err}
	}
	if original != StoreVersion {
		// Keep the exact pre-migration bytes: an older KeyboarDeer can still
		// read them, and a migration bug never destroys the only copy.
		backup := fmt.Sprintf("%s.v%d-backup", s.path, original)
		if err := writeFileAtomic(backup, data); err != nil {
			return StoreData{}, fmt.Errorf("back up profile store before migration: %w", err)
		}
		if err := s.save(store); err != nil {
			return StoreData{}, err
		}
	}
	return store, nil
}

// migrations upgrade a store from the keyed version to the next one. Each step
// must be deterministic and must not drop user data.
var migrations = map[int]func(*StoreData){
	// Version 0 predates the explicit version field and draft revisions.
	0: func(store *StoreData) {
		for index := range store.Profiles {
			if store.Profiles[index].DraftRevision == 0 {
				store.Profiles[index].DraftRevision = 1
			}
		}
	},
	// Version 2 allows several profiles per keyboard and records which one is
	// selected. Prefer the profile already linked to a manager configuration,
	// otherwise the earliest-created one, so the visible draft is unchanged.
	1: func(store *StoreData) {
		store.Selected = map[string]string{}
		for _, candidate := range store.Profiles {
			current, exists := store.Selected[candidate.DeviceID]
			if !exists {
				store.Selected[candidate.DeviceID] = candidate.ID
				continue
			}
			selected := store.find(current)
			if selected.ManagerConfigurationID == "" && (candidate.ManagerConfigurationID != "" || candidate.CreatedAt.Before(selected.CreatedAt)) {
				store.Selected[candidate.DeviceID] = candidate.ID
			}
		}
	},
}

func (data *StoreData) find(id string) *Profile {
	for index := range data.Profiles {
		if data.Profiles[index].ID == id {
			return &data.Profiles[index]
		}
	}
	return nil
}

// reselect keeps each keyboard's selection pointing at one of its profiles.
func (data *StoreData) reselect(deviceID string) {
	if selected, exists := data.Selected[deviceID]; exists {
		if profile := data.find(selected); profile != nil && profile.DeviceID == deviceID {
			return
		}
	}
	remaining := data.ProfilesForDevice(deviceID)
	if len(remaining) == 0 {
		delete(data.Selected, deviceID)
		return
	}
	if data.Selected == nil {
		data.Selected = map[string]string{}
	}
	data.Selected[deviceID] = remaining[0].ID
}

// Select records which profile is opened for a keyboard. It does not change
// any draft revision and never affects the manager.
func (s *Store) Select(deviceID, profileID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := s.load()
	if err != nil {
		return err
	}
	profile := data.find(profileID)
	if profile == nil || profile.DeviceID != deviceID {
		return fmt.Errorf("profile %q is not a profile for this keyboard", profileID)
	}
	if data.Selected == nil {
		data.Selected = map[string]string{}
	}
	data.Selected[deviceID] = profileID
	return s.save(data)
}

func (s *Store) Save(data StoreData) error { s.mu.Lock(); defer s.mu.Unlock(); return s.save(data) }
func (s *Store) save(data StoreData) error {
	if err := ValidateStore(data); err != nil {
		return err
	}
	encoded, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return err
	}
	return writeFileAtomic(s.path, append(encoded, '\n'))
}

// writeFileAtomic writes a private temporary file, syncs it, and renames it
// over the destination. A crash leaves either the old or the new complete
// file, never a torn one; an orphaned temporary file is ignored by Load.
func writeFileAtomic(path string, contents []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".profiles-*")
	if err != nil {
		return err
	}
	name := temporary.Name()
	defer os.Remove(name)
	if err = temporary.Chmod(0o600); err == nil {
		_, err = temporary.Write(contents)
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
	if err := os.Rename(name, path); err != nil {
		return err
	}
	dir, err := os.Open(filepath.Dir(path))
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
		// A newly created profile is the one the user is about to edit.
		if store.Selected == nil {
			store.Selected = map[string]string{}
		}
		store.Selected[profile.DeviceID] = profile.ID
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
			// Moving the link lets a keyboard switch profiles while keeping
			// its single manager configuration.
			for other := range data.Profiles {
				if data.Profiles[other].ID != id && data.Profiles[other].ManagerConfigurationID == configurationID {
					data.Profiles[other].ManagerConfigurationID = ""
				}
			}
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
	target := store.find(id)
	if target == nil {
		return fmt.Errorf("profile %q does not exist", id)
	}
	if target.DraftRevision != expectedDraftRevision {
		return &StaleDraftError{ProfileID: id, Expected: expectedDraftRevision, Actual: target.DraftRevision}
	}
	if target.ApplyPending != nil {
		return fmt.Errorf("profile %q has an apply with an unknown outcome and cannot be deleted yet", id)
	}
	deviceID := target.DeviceID
	next := make([]Profile, 0, len(store.Profiles)-1)
	for _, profile := range store.Profiles {
		if profile.ID != id {
			next = append(next, profile)
		}
	}
	store.Profiles = next
	store.reselect(deviceID)
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
