package admission

import (
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func packageRoot(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	return filepath.Clean(filepath.Join(filepath.Dir(file), "..", ".."))
}

func TestProofClosure(t *testing.T) {
	root := packageRoot(t)
	summary, err := RunProof(
		filepath.Join(root, "policy"), filepath.Join(root, "fixtures"),
		"0123456789abcdef0123456789abcdef01234567",
		"git-tree-sha1:1111111111111111111111111111111111111111",
		"git-tree-sha1:2222222222222222222222222222222222222222",
		t.TempDir(),
	)
	if err != nil {
		t.Fatal(err)
	}
	if summary.Status != "PASS" {
		t.Fatalf("status=%s", summary.Status)
	}
	if summary.ProviderCases != 36 {
		t.Fatalf("providerCases=%d", summary.ProviderCases)
	}
	if len(summary.Cases) != 13 {
		t.Fatalf("cases=%d", len(summary.Cases))
	}
}

func TestMutableRefRejected(t *testing.T) {
	err := ValidateExactPolicyRef("proposals")
	if err == nil || !strings.Contains(err.Error(), "MUTABLE_POLICY_REF") {
		t.Fatalf("err=%v", err)
	}
}

func TestIncompleteContractBlocks(t *testing.T) {
	root := packageRoot(t)
	b, err := LoadBundle(filepath.Join(root, "policy"))
	if err != nil {
		t.Fatal(err)
	}
	b.Contracts[0].PublicContracts[0].Input = ""
	observations, err := ContractObservations(b)
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range b.Profiles {
		o, err := finalizeObservation(Observation{
			Schema: "shiftleft-observation/1", RuleID: p.RuleID, ProfileID: p.ID,
			PackageID: "fixture", Language: p.Language, Required: true, Status: StatusMet,
			FindingCode: "provider-contract-clean", ConfigSHA256: "sha256:" + shaHex([]byte(p.ID)),
			Tool: ToolIdentity{Name: p.Tool}, Evidence: []Evidence{{Kind: "test", Detail: "met"}},
		})
		if err != nil {
			t.Fatal(err)
		}
		observations = append(observations, o)
	}
	r, err := Admit(b,
		"0123456789abcdef0123456789abcdef01234567", b.Hash,
		"git-tree-sha1:1111111111111111111111111111111111111111",
		"git-tree-sha1:2222222222222222222222222222222222222222", observations)
	if err != nil {
		t.Fatal(err)
	}
	if r.Verdict != "BLOCK" || r.TerminalState != "BLOCKED_PACKAGE_CONTRACT" {
		t.Fatalf("%s/%s", r.Verdict, r.TerminalState)
	}
}

func TestReceiptCandidateBinding(t *testing.T) {
	root := packageRoot(t)
	b, err := LoadBundle(filepath.Join(root, "policy"))
	if err != nil {
		t.Fatal(err)
	}
	internal, err := ContractObservations(b)
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range b.Profiles {
		o, err := finalizeObservation(Observation{Schema: "shiftleft-observation/1", RuleID: p.RuleID, ProfileID: p.ID, PackageID: "fixture", Language: p.Language, Required: true, Status: StatusMet, FindingCode: "provider-contract-clean", ConfigSHA256: "sha256:" + shaHex([]byte(p.ID)), Tool: ToolIdentity{Name: p.Tool}, Evidence: []Evidence{{Kind: "test", Detail: "met"}}})
		if err != nil {
			t.Fatal(err)
		}
		internal = append(internal, o)
	}
	base := "git-tree-sha1:1111111111111111111111111111111111111111"
	candidate := "git-tree-sha1:2222222222222222222222222222222222222222"
	r, err := Admit(b, "0123456789abcdef0123456789abcdef01234567", b.Hash, base, candidate, internal)
	if err != nil {
		t.Fatal(err)
	}
	err = VerifyReceiptBinding(r, b.Hash, base, "git-tree-sha1:3333333333333333333333333333333333333333")
	if err == nil || !strings.Contains(err.Error(), "CANDIDATE_TREE_MISMATCH") {
		t.Fatalf("err=%v", err)
	}
}

func TestObservedUnmetIsNotReclassifiedUnobserved(t *testing.T) {
	root := packageRoot(t)
	b, err := LoadBundle(filepath.Join(root, "policy"))
	if err != nil {
		t.Fatal(err)
	}
	obs, err := ContractObservations(b)
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range b.Profiles {
		status, code := StatusMet, "provider-contract-clean"
		if p.ID == "javascript.core-imports" {
			status, code = StatusUnmet, "core-imports-effect-adapter"
		}
		o, err := finalizeObservation(Observation{
			Schema: "shiftleft-observation/1", RuleID: p.RuleID, ProfileID: p.ID,
			PackageID: "fixture", Language: p.Language, Required: true, Status: status,
			FindingCode: code, ConfigSHA256: "sha256:" + shaHex([]byte(p.ID)),
			Tool: ToolIdentity{Name: p.Tool}, Evidence: []Evidence{{Kind: "test", Detail: status}},
		})
		if err != nil {
			t.Fatal(err)
		}
		obs = append(obs, o)
	}
	r, err := Admit(b,
		"0123456789abcdef0123456789abcdef01234567", b.Hash,
		"git-tree-sha1:1111111111111111111111111111111111111111",
		"git-tree-sha1:2222222222222222222222222222222222222222", obs)
	if err != nil {
		t.Fatal(err)
	}
	if r.TerminalState != "BLOCKED_RULE" || r.Counts.RequiredUnobserved != 0 {
		t.Fatalf("terminal=%s requiredUnobserved=%d", r.TerminalState, r.Counts.RequiredUnobserved)
	}
}

func TestBlockerFixtureMatrixIsExecutable(t *testing.T) {
	root := packageRoot(t)
	b, err := LoadBundle(filepath.Join(root, "policy"))
	if err != nil {
		t.Fatal(err)
	}
	fixturesDir := filepath.Join(root, "fixtures")
	rules, specs, err := ObserveRuleFixtures(b, fixturesDir)
	if err != nil {
		t.Fatal(err)
	}
	if len(rules) != 20 || len(specs) != 20 {
		t.Fatalf("rules=%d specs=%d", len(rules), len(specs))
	}
	providers, err := ObserveFixtures(b, fixturesDir)
	if err != nil {
		t.Fatal(err)
	}
	if len(providers) != 16 {
		t.Fatalf("providers=%d", len(providers))
	}
	coverage, err := FixtureCoverageObservations(b, providers, rules)
	if err != nil {
		t.Fatal(err)
	}
	if len(coverage) != 7 {
		t.Fatalf("coverage=%d", len(coverage))
	}
	for _, o := range coverage {
		if o.Status != StatusMet {
			t.Fatalf("%s=%s", o.PackageID, o.Status)
		}
	}
}
