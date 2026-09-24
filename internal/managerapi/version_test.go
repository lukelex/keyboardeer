package managerapi

import "testing"

func TestSupportsDurableMutationIdempotency(t *testing.T) {
	for _, version := range []string{"v1.1.0", "1.1.0", "v1.2.3", "v2.0.0", "v1.1.0+build-5"} {
		if !SupportsDurableMutationIdempotency(version) {
			t.Errorf("%q should support durable mutation idempotency", version)
		}
	}
	for _, version := range []string{"", "dev", "1.0.9", "v1.0.9", "v1", "v1.1.0-rc.1", "development"} {
		if SupportsDurableMutationIdempotency(version) {
			t.Errorf("%q must not assume durable mutation idempotency", version)
		}
	}
}
