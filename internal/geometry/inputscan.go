package geometry

import "fmt"

// NormalizeInputScanTokens translates the canonical manager kmonad-v1 names
// to the spellings used by the verified visual catalog. The manager owns the
// platform-to-KMonad translation; this is only a versioned namespace bridge.
func NormalizeInputScanTokens(tokens []string) (map[string]bool, error) {
	aliases := map[string]string{
		"102nd": "102d", "kpenter": "kprt", "numlock": "nlck",
		"scrolllock": "slck", "sysrq": "ssrq", "compose": "cmp",
		"menu": "cmp", "right": "rght", "kpslash": "kp/",
		"kpasterisk": "kp*", "kpminus": "kp-", "kpplus": "kp+",
		"kpdot": "kp.", "volumedown": "vold", "volumeup": "volu",
	}
	canonical := make(map[string]bool, len(tokens))
	for _, token := range tokens {
		if alias, ok := aliases[token]; ok {
			token = alias
		}
		constructor, ok := KMonadConstructor(token)
		if !ok {
			return nil, fmt.Errorf("unknown manager input token %q", token)
		}
		canonical[constructor] = true
	}
	return canonical, nil
}

type ScanMatchKind string

const (
	ScanExact    ScanMatchKind = "exact"
	ScanSuperset ScanMatchKind = "superset"
	ScanSubset   ScanMatchKind = "subset"
	ScanPartial  ScanMatchKind = "partial"
)

type ScanMatch struct {
	GeometryID string        `json:"geometry_id"`
	Name       string        `json:"name"`
	Kind       ScanMatchKind `json:"kind"`
	Missing    int           `json:"missing"`
	Extra      int           `json:"extra"`
}

// MatchInputScan ranks catalog templates without inferring a layout. Exact
// matches are preferred, followed by templates that are a subset/superset of
// the attested set. A partial result is still returned so the UI can explain
// why no verified template fits.
func MatchInputScan(tokens []string) ([]ScanMatch, error) {
	observed, err := NormalizeInputScanTokens(tokens)
	if err != nil {
		return nil, err
	}
	matches := make([]ScanMatch, 0, len(List()))
	for _, template := range List() {
		expected := make(map[string]bool)
		for _, key := range template.Keys {
			constructor, ok := KMonadConstructor(key.SourceKey)
			if !ok {
				return nil, fmt.Errorf("catalog contains unknown KMonad token %q", key.SourceKey)
			}
			expected[constructor] = true
		}
		missing, extra := 0, 0
		for key := range expected {
			if !observed[key] {
				missing++
			}
		}
		for key := range observed {
			if !expected[key] {
				extra++
			}
		}
		kind := ScanPartial
		switch {
		case missing == 0 && extra == 0:
			kind = ScanExact
		case missing == 0:
			kind = ScanSuperset
		case extra == 0:
			kind = ScanSubset
		}
		matches = append(matches, ScanMatch{GeometryID: template.ID, Name: template.Name, Kind: kind, Missing: missing, Extra: extra})
	}
	// Stable catalog order is retained for ties; exact/smaller-diff matches
	// appear first without using a device name or product heuristic.
	for i := 1; i < len(matches); i++ {
		for j := i; j > 0 && scanMatchLess(matches[j], matches[j-1]); j-- {
			matches[j], matches[j-1] = matches[j-1], matches[j]
		}
	}
	return matches, nil
}

func scanMatchLess(a, b ScanMatch) bool {
	rank := func(kind ScanMatchKind) int {
		switch kind {
		case ScanExact:
			return 0
		case ScanSuperset, ScanSubset:
			return 1
		default:
			return 2
		}
	}
	ra, rb := rank(a.Kind), rank(b.Kind)
	if ra != rb {
		return ra < rb
	}
	if a.Missing+a.Extra != b.Missing+b.Extra {
		return a.Missing+a.Extra < b.Missing+b.Extra
	}
	return false
}
