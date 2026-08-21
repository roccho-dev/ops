package packagedocs

import "testing"

func TestApplyPhaseDefersOnlyDistribution(t *testing.T) {
	distribution, err := finalizeObservation(Observation{
		Schema:       ObservationSchema,
		RuleID:       RuleDistribution,
		ProfileID:    "package.docs.distribution",
		PackageID:    "example",
		Language:     "language-neutral",
		Required:     true,
		Status:       "unobserved",
		FindingCode:  "required-distribution-unobserved",
		ConfigSHA256: shaDigest([]byte("distribution")),
		Tool:         ToolIdentity{Name: "package-docs", Version: "1", AdapterSHA256: "builtin", Digest: shaDigest([]byte("tool"))},
		Evidence:     []Evidence{{Kind: "surface", Detail: "missing"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	identity, err := finalizeObservation(Observation{
		Schema:       ObservationSchema,
		RuleID:       RuleIdentity,
		ProfileID:    "package.docs.identity",
		PackageID:    "example",
		Language:     "language-neutral",
		Required:     true,
		Status:       "met",
		FindingCode:  "package-identity-bound",
		ConfigSHA256: shaDigest([]byte("identity")),
		Tool:         ToolIdentity{Name: "package-docs", Version: "1", AdapterSHA256: "builtin", Digest: shaDigest([]byte("tool"))},
		Evidence:     []Evidence{{Kind: "contract", Detail: "bound"}},
	})
	if err != nil {
		t.Fatal(err)
	}

	got, err := ApplyPhase([]Observation{identity, distribution}, PhasePreflight)
	if err != nil {
		t.Fatal(err)
	}
	if got[0].Status != "met" || got[0].ObservationDigest != identity.ObservationDigest {
		t.Fatalf("identity changed: %+v", got[0])
	}
	if got[1].Status != "not-applicable" || got[1].FindingCode != "distribution-deferred-to-package-build" {
		t.Fatalf("distribution not deferred: %+v", got[1])
	}
	if got[1].ObservationDigest == distribution.ObservationDigest {
		t.Fatal("deferred observation digest was not recomputed")
	}

	full, err := ApplyPhase([]Observation{distribution}, PhaseFull)
	if err != nil {
		t.Fatal(err)
	}
	if full[0].ObservationDigest != distribution.ObservationDigest {
		t.Fatal("full phase changed the observation")
	}
	if _, err := ApplyPhase(nil, "other"); err == nil {
		t.Fatal("invalid phase accepted")
	}
}
