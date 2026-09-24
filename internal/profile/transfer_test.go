package profile

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestPortableTransferRoundTripsBehaviorButNotRuntimeIdentity(t *testing.T) {
	source, err := New("physical-device", "Travel", Geometry{ID: "ansi", SourceKeys: []string{"esc", "a"}})
	if err != nil {
		t.Fatal(err)
	}
	source.Assignments = []Assignment{{LayerID: "base", SourceKey: "a", Behavior: Behavior{Kind: "key", Key: "b"}}}
	source.ManagerConfigurationID = "managed-config"
	source.ApplyPending = &PendingApply{ManagerServerID: "server", StartedAt: source.CreatedAt}
	encoded, err := Export(source)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "physical-device") || strings.Contains(string(encoded), "managed-config") || strings.Contains(string(encoded), "apply_pending") || strings.Contains(string(encoded), "defcfg") {
		t.Fatalf("portable profile leaked runtime identity or became a .kbd: %s", encoded)
	}
	imported, err := Import(encoded, "destination-device")
	if err != nil {
		t.Fatal(err)
	}
	if imported.DeviceID != "destination-device" || imported.ID == source.ID || imported.ManagerConfigurationID != "" || imported.ApplyPending != nil || len(imported.Assignments) != 1 || imported.Assignments[0].Behavior.Key != "b" {
		t.Fatalf("unexpected imported draft: %#v", imported)
	}
}

func TestPortableTransferRejectsUnsupportedAndMalformedDocuments(t *testing.T) {
	base, _ := Export(testProfile(t, "portable"))
	var object map[string]any
	if err := json.Unmarshal(base, &object); err != nil {
		t.Fatal(err)
	}
	object["version"] = float64(99)
	unsupported, _ := json.Marshal(object)
	for _, data := range [][]byte{unsupported, []byte(`{"format":"keyboardeer-profile","version":1,"unknown":true}`), append(base, []byte(` {}`)...), make([]byte, (4<<20)+1)} {
		if _, err := Import(data, "device"); err == nil {
			t.Fatalf("accepted invalid portable profile %q", data[:min(len(data), 100)])
		}
	}
}
