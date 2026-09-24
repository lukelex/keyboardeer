package geometry

import "testing"

func TestCommunityDeviceTemplatesAreValidAndResolveVerifiedGeometry(t *testing.T) {
	if err := ValidateDeviceTemplates(); err != nil {
		t.Fatal(err)
	}
	devices := DeviceTemplates()
	if len(devices) != 3 {
		t.Fatalf("device templates = %d, want 3", len(devices))
	}
	for _, device := range devices {
		t.Run(device.ID, func(t *testing.T) {
			resolved, err := device.DeviceTemplateGeometry()
			if err != nil {
				t.Fatal(err)
			}
			if resolved.ID != device.GeometryID {
				t.Fatalf("resolved geometry = %q, want %q", resolved.ID, device.GeometryID)
			}
			if err := resolved.Validate(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestCommunityDeviceTemplatesAreIndependentCopies(t *testing.T) {
	first, ok := LookupDeviceTemplate(DeviceX220ISOUSID)
	if !ok {
		t.Fatal("X220 device template was not found")
	}
	first.Evidence[0].Note = "changed"
	second, ok := LookupDeviceTemplate(DeviceX220ISOUSID)
	if !ok || second.Evidence[0].Note == "changed" {
		t.Fatal("device template evidence was not copied")
	}
}

func TestDeviceTemplateDoesNotUseBrandAsGeometryIdentity(t *testing.T) {
	for _, device := range DeviceTemplates() {
		if device.GeometryID == device.Brand || device.GeometryID == device.Model {
			t.Fatalf("device %q uses product metadata as geometry identity", device.ID)
		}
	}
}
