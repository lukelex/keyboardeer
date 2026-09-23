// Package compiler deterministically converts KeyboarDeer's editable profile
// model into the manager's platform-neutral KMonad behavior payload. It never
// emits defcfg or accesses a device.
package compiler

import (
	"fmt"
	"regexp"
	"sort"
	"strings"

	"github.com/lukelex/keyboardeer/internal/profile"
)

var identifier = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9-]*$`)
var keyAtom = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9+*/.,;'\[\]=-]*$`)

type Span struct {
	StartLine   int `json:"start_line"`
	StartColumn int `json:"start_column"`
	EndLine     int `json:"end_line"`
	EndColumn   int `json:"end_column"`
}

// SourceMapEntry identifies one emitted deflayer slot. Entries include
// inherited defaults as well as direct assignments so a diagnostic can be
// shown at the correct key without blaming the last selected key.
type SourceMapEntry struct {
	LayerID   string `json:"layer_id"`
	SourceKey string `json:"source_key"`
	Explicit  bool   `json:"explicit"`
	Span      Span   `json:"span"`
}

type Result struct {
	Behavior  string           `json:"behavior"`
	SourceMap []SourceMapEntry `json:"source_map"`
}

func Compile(input profile.Profile) (Result, error) {
	if err := profile.Validate(input); err != nil {
		return Result{}, fmt.Errorf("invalid profile: %w", err)
	}
	if err := validateIdentifiers(input); err != nil {
		return Result{}, err
	}
	if err := validateDeclarationCycles(input); err != nil {
		return Result{}, err
	}
	assignments := make(map[string]profile.Behavior, len(input.Assignments))
	for _, assignment := range input.Assignments {
		assignments[address(assignment.LayerID, assignment.SourceKey)] = assignment.Behavior
	}
	writer := &textWriter{line: 1, column: 1}
	writer.linef("(defsrc")
	for _, sourceKey := range input.Geometry.SourceKeys {
		if err := validateKeyAtom(sourceKey); err != nil {
			return Result{}, fmt.Errorf("invalid source key %q: %w", sourceKey, err)
		}
		writer.linef("  %s", sourceKey)
	}
	writer.linef(")")
	if len(input.Aliases) != 0 || len(input.Macros) != 0 {
		writer.linef("")
		writer.linef("(defalias")
		for _, declaration := range declarations(input) {
			value, err := renderDeclaration(declaration)
			if err != nil {
				return Result{}, fmt.Errorf("compile %s %q: %w", declaration.kind, declaration.name, err)
			}
			writer.linef("  %s %s", declaration.name, value)
		}
		writer.linef(")")
	}
	result := Result{}
	for layerIndex, layer := range input.Layers {
		writer.linef("")
		writer.linef("(deflayer %s", layer.ID)
		for _, sourceKey := range input.Geometry.SourceKeys {
			behavior, explicit := assignments[address(layer.ID, sourceKey)]
			if !explicit {
				if layerIndex == 0 {
					behavior = profile.Behavior{Kind: "key", Key: sourceKey}
				} else {
					behavior = profile.Behavior{Kind: "transparent"}
				}
			}
			value, err := renderBehavior(behavior)
			if err != nil {
				return Result{}, fmt.Errorf("compile %s/%s: %w", layer.ID, sourceKey, err)
			}
			line := writer.line
			writer.linef("  %s", value)
			span := Span{StartLine: line, StartColumn: 3, EndLine: line, EndColumn: 3 + len(value)}
			result.SourceMap = append(result.SourceMap, SourceMapEntry{LayerID: layer.ID, SourceKey: sourceKey, Explicit: explicit, Span: span})
		}
		writer.linef(")")
	}
	result.Behavior = writer.String()
	return result, nil
}

type declaration struct {
	name     string
	kind     string
	behavior profile.Behavior
	macro    []profile.Behavior
}

func declarations(input profile.Profile) []declaration {
	result := make([]declaration, 0, len(input.Aliases)+len(input.Macros))
	for name, behavior := range input.Aliases {
		result = append(result, declaration{name: name, kind: "alias", behavior: behavior})
	}
	for name, macro := range input.Macros {
		result = append(result, declaration{name: name, kind: "macro", macro: macro})
	}
	sort.Slice(result, func(left, right int) bool { return result[left].name < result[right].name })
	return result
}

func renderDeclaration(declaration declaration) (string, error) {
	if declaration.kind == "alias" {
		return renderBehavior(declaration.behavior)
	}
	parts := make([]string, len(declaration.macro))
	for index, behavior := range declaration.macro {
		value, err := renderBehavior(behavior)
		if err != nil {
			return "", err
		}
		parts[index] = value
	}
	return "#(" + strings.Join(parts, " ") + ")", nil
}

func validateIdentifiers(input profile.Profile) error {
	for _, layer := range input.Layers {
		if !identifier.MatchString(layer.ID) {
			return fmt.Errorf("invalid layer ID %q", layer.ID)
		}
	}
	for _, declaration := range declarations(input) {
		if !identifier.MatchString(declaration.name) {
			return fmt.Errorf("invalid %s name %q", declaration.kind, declaration.name)
		}
	}
	return nil
}

func validateDeclarationCycles(input profile.Profile) error {
	references := make(map[string][]string, len(input.Aliases)+len(input.Macros))
	for name, behavior := range input.Aliases {
		references[name] = behaviorReferences(behavior)
	}
	for name, macro := range input.Macros {
		for _, behavior := range macro {
			references[name] = append(references[name], behaviorReferences(behavior)...)
		}
	}
	visiting, visited := map[string]bool{}, map[string]bool{}
	var visit func(string) error
	visit = func(name string) error {
		if visiting[name] {
			return fmt.Errorf("cyclic alias or macro reference at %q", name)
		}
		if visited[name] {
			return nil
		}
		visiting[name] = true
		for _, reference := range references[name] {
			if err := visit(reference); err != nil {
				return err
			}
		}
		visiting[name], visited[name] = false, true
		return nil
	}
	for name := range references {
		if err := visit(name); err != nil {
			return err
		}
	}
	return nil
}

func behaviorReferences(behavior profile.Behavior) []string {
	result := []string{}
	if behavior.Kind == "alias" || behavior.Kind == "macro" {
		result = append(result, behavior.Target)
	}
	if behavior.Tap != nil {
		result = append(result, behaviorReferences(*behavior.Tap)...)
	}
	if behavior.Hold != nil {
		result = append(result, behaviorReferences(*behavior.Hold)...)
	}
	return result
}

func renderBehavior(behavior profile.Behavior) (string, error) {
	switch behavior.Kind {
	case "key":
		if err := validateKeyAtom(behavior.Key); err != nil {
			return "", err
		}
		if behavior.Key == "\\" {
			return "\\\\", nil
		}
		return behavior.Key, nil
	case "transparent":
		return "_", nil
	case "disabled":
		return "XX", nil
	case "hold_layer":
		return "(layer-toggle " + behavior.Target + ")", nil
	case "switch_layer":
		return "(layer-switch " + behavior.Target + ")", nil
	case "alias", "macro":
		return "@" + behavior.Target, nil
	case "tap_hold":
		tap, err := renderBehavior(*behavior.Tap)
		if err != nil {
			return "", err
		}
		hold, err := renderBehavior(*behavior.Hold)
		if err != nil {
			return "", err
		}
		return fmt.Sprintf("(tap-hold %d %s %s)", behavior.TimeoutMS, tap, hold), nil
	default:
		return "", fmt.Errorf("unsupported behavior kind %q", behavior.Kind)
	}
}

func validateKeyAtom(value string) error {
	if value == "\\" || strings.ContainsRune("-=[];',./+*", runeValue(value)) {
		return nil
	}
	if value == "" || value == "_" || value == "XX" || !keyAtom.MatchString(value) {
		return fmt.Errorf("unsafe KMonad key token %q", value)
	}
	return nil
}

func runeValue(value string) rune {
	if len(value) == 1 {
		return rune(value[0])
	}
	return 0
}

func address(layerID, sourceKey string) string { return layerID + "\x00" + sourceKey }

type textWriter struct {
	content strings.Builder
	line    int
	column  int
}

func (writer *textWriter) linef(format string, values ...any) Span {
	text := fmt.Sprintf(format, values...)
	span := Span{StartLine: writer.line, StartColumn: writer.column, EndLine: writer.line, EndColumn: writer.column + len(text)}
	writer.content.WriteString(text)
	writer.content.WriteByte('\n')
	writer.line++
	writer.column = 1
	return span
}

func (writer *textWriter) String() string { return writer.content.String() }
