package geometry

import "fmt"

// DeviceTemplate is a community/device-specific presentation that reuses a
// verified, brand-neutral geometry. Device metadata helps users find a visual
// representation; it is never used as an automatic layout-selection signal.
//
// A device template must reference an existing GeometryID. It cannot introduce
// a new source-key order or bypass geometry verification.
type DeviceTemplate struct {
	ID          string           `json:"id"`
	Name        string           `json:"name"`
	Brand       string           `json:"brand"`
	Model       string           `json:"model"`
	Variant     string           `json:"variant,omitempty"`
	GeometryID  string           `json:"geometry_id"`
	Description string           `json:"description"`
	Evidence    []DeviceEvidence `json:"evidence"`
}

// DeviceEvidence records why a community template claims to represent a
// particular variant. Evidence is descriptive metadata, not detection input.
type DeviceEvidence struct {
	Kind string `json:"kind"`
	URL  string `json:"url"`
	Note string `json:"note,omitempty"`
}

const (
	DeviceX220ISOUSID    = "thinkpad-x220-iso-us-v1"
	DeviceT430ISOUSID    = "thinkpad-t430-iso-us-v1"
	DeviceFreestyle2USID = "kinesis-freestyle2-device-v1"
)

var communityDeviceTemplates = []DeviceTemplate{
	{
		ID: "thinkpad-x220-iso-us-v1", Name: "ThinkPad X220 ISO (US)",
		Brand: "Lenovo", Model: "ThinkPad X220", Variant: "ISO US",
		GeometryID:  LaptopISO93ID,
		Description: "Community device template bound to the verified ISO Laptop 93 geometry.",
		Evidence:    []DeviceEvidence{{Kind: "kmonad-template", URL: "https://github.com/kmonad/kmonad/blob/30b9705fb56059483969624d58cad077d5c62300/keymap/template/thinkpad_x220_iso.kbd", Note: "US defsrc source order at the pinned KMonad commit."}},
	},
	{
		ID: "thinkpad-t430-iso-us-v1", Name: "ThinkPad T430 ISO (US)",
		Brand: "Lenovo", Model: "ThinkPad T430", Variant: "ISO US",
		GeometryID:  LaptopISO87ID,
		Description: "Community device template bound to the verified ISO Laptop 87 geometry.",
		Evidence:    []DeviceEvidence{{Kind: "kmonad-template", URL: "https://github.com/kmonad/kmonad/blob/30b9705fb56059483969624d58cad077d5c62300/keymap/template/thinkpad_T430_iso.kbd", Note: "US defsrc source order at the pinned KMonad commit."}},
	},
	{
		ID: DeviceFreestyle2USID, Name: "Kinesis Freestyle 2",
		Brand: "Kinesis", Model: "Freestyle 2", Variant: "documented template",
		GeometryID:  Split94ID,
		Description: "Community device template bound to the verified Split 94 convention.",
		Evidence:    []DeviceEvidence{{Kind: "kmonad-template", URL: "https://github.com/kmonad/kmonad/blob/30b9705fb56059483969624d58cad077d5c62300/keymap/template/freestyle2.kbd", Note: "Published source order at the pinned KMonad commit."}},
	},
}

// DeviceTemplates returns independent copies of the community catalog.
func DeviceTemplates() []DeviceTemplate {
	result := make([]DeviceTemplate, len(communityDeviceTemplates))
	for index, template := range communityDeviceTemplates {
		result[index] = cloneDeviceTemplate(template)
	}
	return result
}

// LookupDeviceTemplate resolves a community/device template by its stable ID.
func LookupDeviceTemplate(id string) (DeviceTemplate, bool) {
	for _, template := range communityDeviceTemplates {
		if template.ID == id {
			return cloneDeviceTemplate(template), true
		}
	}
	return DeviceTemplate{}, false
}

// DeviceTemplateGeometry resolves the verified visual/source geometry selected
// by a community template. Callers should show the returned geometry and the
// device evidence together; the device binding is not a replacement for the
// underlying layout identity.
func (template DeviceTemplate) DeviceTemplateGeometry() (Template, error) {
	geometry, found := Lookup(template.GeometryID)
	if !found {
		return Template{}, fmt.Errorf("device template %q references unknown geometry %q", template.ID, template.GeometryID)
	}
	return geometry, nil
}

func validateDeviceTemplate(template DeviceTemplate) error {
	if template.ID == "" || template.Name == "" || template.Brand == "" || template.Model == "" || template.GeometryID == "" || template.Description == "" {
		return fmt.Errorf("device template requires ID, name, brand, model, geometry ID, and description")
	}
	if _, found := Lookup(template.GeometryID); !found {
		return fmt.Errorf("device template %q references unknown geometry %q", template.ID, template.GeometryID)
	}
	if len(template.Evidence) == 0 {
		return fmt.Errorf("device template %q requires evidence", template.ID)
	}
	for _, evidence := range template.Evidence {
		if evidence.Kind == "" || evidence.URL == "" {
			return fmt.Errorf("device template %q contains incomplete evidence", template.ID)
		}
	}
	return nil
}

// ValidateDeviceTemplates checks the complete built-in community catalog.
func ValidateDeviceTemplates() error {
	seen := make(map[string]bool, len(communityDeviceTemplates))
	for _, template := range communityDeviceTemplates {
		if seen[template.ID] {
			return fmt.Errorf("duplicate device template ID %q", template.ID)
		}
		seen[template.ID] = true
		if err := validateDeviceTemplate(template); err != nil {
			return err
		}
	}
	return nil
}

func cloneDeviceTemplate(template DeviceTemplate) DeviceTemplate {
	template.Evidence = append([]DeviceEvidence(nil), template.Evidence...)
	return template
}
