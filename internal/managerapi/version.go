package managerapi

import (
	"strconv"
	"strings"
)

// SupportsDurableMutationIdempotency reports whether a published manager
// version implements the durable idempotency contract added in v1.1.0.
// Development/unknown version strings deliberately return false: the GUI must
// not assume that replaying an uncertain mutation is safe.
func SupportsDurableMutationIdempotency(version string) bool {
	version = strings.TrimPrefix(strings.TrimSpace(version), "v")
	stableVersion := strings.SplitN(version, "+", 2)[0]
	if strings.Contains(stableVersion, "-") {
		return false
	}
	parts := strings.SplitN(version, ".", 3)
	if len(parts) != 3 {
		return false
	}
	major, err := strconv.Atoi(parts[0])
	if err != nil {
		return false
	}
	minor, err := strconv.Atoi(parts[1])
	if err != nil {
		return false
	}
	patch := strings.SplitN(strings.SplitN(parts[2], "+", 2)[0], "-", 2)[0]
	if _, err := strconv.Atoi(patch); err != nil {
		return false
	}
	return major > 1 || (major == 1 && minor >= 1)
}
