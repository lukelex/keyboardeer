package managerapi

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestDeviceFixtureKeepsUnknownEnumsReadable(t *testing.T) {
	bytes, err := os.ReadFile(filepath.Join("testdata", "device-list.json"))
	if err != nil {
		t.Fatal(err)
	}
	var result DeviceListResult
	if err := json.Unmarshal(bytes, &result); err != nil {
		t.Fatal(err)
	}
	if len(result.Devices) != 1 || result.Devices[0].Role != "manager_output" || result.Devices[0].Availability != "mystery_future_state" || result.Devices[0].ReasonCode != "future_reason" {
		t.Fatalf("future values were not retained: %#v", result)
	}
}
