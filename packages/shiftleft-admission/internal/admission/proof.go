package admission

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

func expectedFixtureMap(fixturesDir string) (map[string]Fixture, error) {
	out := map[string]Fixture{}
	err := filepath.WalkDir(fixturesDir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || d.Name() != "fixture.json" {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		var f Fixture
		if err := json.Unmarshal(data, &f); err != nil {
			return err
		}
		out[f.CaseID] = f
		return nil
	})
	return out, err
}

func copyDir(src, dst, skip string) error {
	return filepath.WalkDir(src, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		if rel == "." {
			return os.MkdirAll(dst, 0o755)
		}
		if rel == skip {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		target := filepath.Join(dst, rel)
		if d.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		return os.WriteFile(target, data, 0o644)
	})
}

func syntheticUnobserved(ruleID, profileID, code string) Observation {
	o, _ := finalizeObservation(Observation{Schema: "shiftleft-observation/1", RuleID: ruleID, ProfileID: profileID, PackageID: "proof.synthetic", Language: "synthetic", Required: true, Status: StatusUnobserved, FindingCode: code, ConfigSHA256: "sha256:" + shaHex([]byte(code)), Tool: ToolIdentity{Name: "synthetic"}, Evidence: []Evidence{{Kind: "proof", Detail: code}}})
	return o
}

func RunProof(bundleDir, fixturesDir, policyRef, baseTree, candidateTree, outDir string) (ProofSummary, error) {
	b, err := LoadBundle(bundleDir)
	if err != nil {
		return ProofSummary{}, err
	}
	if err := ValidateExactPolicyRef(policyRef); err != nil {
		return ProofSummary{}, err
	}
	if err := ValidateTreeRef(baseTree); err != nil {
		return ProofSummary{}, err
	}
	if err := ValidateTreeRef(candidateTree); err != nil {
		return ProofSummary{}, err
	}
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		return ProofSummary{}, err
	}
	cases := []ProofCase{}
	add := func(id, status, observed string) {
		cases = append(cases, ProofCase{ID: id, Status: status, Observed: observed})
	}
	all, err := ObserveFixtures(b, fixturesDir)
	if err != nil {
		return ProofSummary{}, err
	}
	expected, err := expectedFixtureMap(fixturesDir)
	if err != nil {
		return ProofSummary{}, err
	}
	fixtureKinds := map[string]map[string]bool{}
	for _, o := range all {
		f, ok := expected[o.CaseID]
		if !ok {
			return ProofSummary{}, fmt.Errorf("PROOF_FIXTURE_UNKNOWN: %s", o.CaseID)
		}
		if o.Status != f.ExpectedStatus || o.FindingCode != f.ExpectedFindingCode {
			return ProofSummary{}, fmt.Errorf("PROOF_FIXTURE_MISMATCH: %s got %s/%s want %s/%s", o.CaseID, o.Status, o.FindingCode, f.ExpectedStatus, f.ExpectedFindingCode)
		}
		if fixtureKinds[o.ProfileID] == nil {
			fixtureKinds[o.ProfileID] = map[string]bool{}
		}
		fixtureKinds[o.ProfileID][o.FixtureKind] = true
	}
	for _, p := range b.Profiles {
		for _, k := range []string{"good", "bad", "false-positive", "false-negative"} {
			if !fixtureKinds[p.ID][k] {
				return ProofSummary{}, fmt.Errorf("PROOF_FIXTURE_KIND_MISSING: %s/%s", p.ID, k)
			}
		}
	}
	meaning := map[string]string{}
	for _, o := range all {
		key := o.RuleID + "\x00" + o.FixtureKind
		value := strings.Join([]string{o.Status, o.FindingCode}, "|")
		if prior, ok := meaning[key]; ok && prior != value {
			return ProofSummary{}, fmt.Errorf("PROOF_PROVIDER_FINDING_DRIFT: %s got %s and %s", key, prior, value)
		}
		meaning[key] = value
	}
	add("provider-finding-parity", "PASS", "provider profiles share status and finding codes within each rule")
	add("provider-fixture-matrix", "PASS", fmt.Sprintf("%d executable provider cases", len(all)))
	if err := writeJSONL(filepath.Join(outDir, "provider-observations.all.jsonl"), append([]Observation(nil), all...)); err != nil {
		return ProofSummary{}, err
	}
	ruleCases, _, err := ObserveRuleFixtures(b, fixturesDir)
	if err != nil {
		return ProofSummary{}, err
	}
	if err := writeJSONL(filepath.Join(outDir, "rule-fixture-observations.all.jsonl"), append([]Observation(nil), ruleCases...)); err != nil {
		return ProofSummary{}, err
	}
	coverage, err := FixtureCoverageObservations(b, all, ruleCases)
	if err != nil {
		return ProofSummary{}, err
	}
	for _, o := range coverage {
		if o.Status != StatusMet {
			return ProofSummary{}, fmt.Errorf("PROOF_FIXTURE_COVERAGE_NOT_MET: %s/%s", o.PackageID, o.FindingCode)
		}
	}
	if err := writeJSONL(filepath.Join(outDir, "fixture-coverage-observations.jsonl"), append([]Observation(nil), coverage...)); err != nil {
		return ProofSummary{}, err
	}
	add("blocker-rule-fixture-matrix", "PASS", fmt.Sprintf("%d executable cases across %d blocker rules", len(all)+len(ruleCases), len(coverage)))
	positive := []Observation{}
	for _, o := range all {
		if o.FixtureKind == "good" || o.FixtureKind == "false-positive" {
			positive = append(positive, o)
		}
	}
	positive = append(positive, coverage...)
	if err := writeJSONL(filepath.Join(outDir, "admission-observations.jsonl"), append([]Observation(nil), positive...)); err != nil {
		return ProofSummary{}, err
	}
	internal, err := ContractObservations(b)
	if err != nil {
		return ProofSummary{}, err
	}
	positive = append(positive, internal...)
	r1, err := Admit(b, policyRef, b.Hash, baseTree, candidateTree, append([]Observation(nil), positive...))
	if err != nil {
		return ProofSummary{}, err
	}
	r2, err := Admit(b, policyRef, b.Hash, baseTree, candidateTree, append([]Observation(nil), positive...))
	if err != nil {
		return ProofSummary{}, err
	}
	if r1.Verdict != "PASS" {
		return ProofSummary{}, fmt.Errorf("PROOF_ADMISSION_NOT_PASS: %s", r1.TerminalState)
	}
	d1, _ := json.Marshal(r1)
	d2, _ := json.Marshal(r2)
	if string(d1) != string(d2) {
		return ProofSummary{}, fmt.Errorf("PROOF_NONDETERMINISTIC_RECEIPT")
	}
	add("clean-two-run-determinism", "PASS", r1.ReceiptDigest)
	if err := writeJSON(filepath.Join(outDir, "receipt.1.json"), r1); err != nil {
		return ProofSummary{}, err
	}
	if err := writeJSON(filepath.Join(outDir, "receipt.2.json"), r2); err != nil {
		return ProofSummary{}, err
	}
	if err := VerifyReceiptBinding(r1, b.Hash, baseTree, candidateTree); err != nil {
		return ProofSummary{}, err
	}
	add("receipt-binding", "PASS", "policy/base/candidate match")

	tmp, err := os.MkdirTemp("", "issue116-tamper-")
	if err != nil {
		return ProofSummary{}, err
	}
	defer os.RemoveAll(tmp)
	if err := copyDir(bundleDir, tmp, ""); err != nil {
		return ProofSummary{}, err
	}
	rulesPath := filepath.Join(tmp, "rules.jsonl")
	fd, err := os.OpenFile(rulesPath, os.O_APPEND|os.O_WRONLY, 0)
	if err != nil {
		return ProofSummary{}, err
	}
	_, _ = fd.WriteString("\n")
	_ = fd.Close()
	if _, err := VerifyBundle(tmp, policyRef, b.Hash); err == nil || !strings.Contains(err.Error(), "POLICY_HASH_MISMATCH") {
		return ProofSummary{}, fmt.Errorf("PROOF_TAMPER_NOT_REJECTED: %v", err)
	}
	add("tampered-policy", "PASS", "POLICY_HASH_MISMATCH")
	missing, err := os.MkdirTemp("", "issue116-missing-")
	if err != nil {
		return ProofSummary{}, err
	}
	defer os.RemoveAll(missing)
	if err := copyDir(bundleDir, missing, "profiles.jsonl"); err != nil {
		return ProofSummary{}, err
	}
	if _, err := LoadBundle(missing); err == nil || !strings.Contains(err.Error(), "MISSING_REQUIRED_INPUT") {
		return ProofSummary{}, fmt.Errorf("PROOF_MISSING_NOT_REJECTED: %v", err)
	}
	add("missing-policy-member", "PASS", "MISSING_REQUIRED_INPUT")
	if err := ValidateExactPolicyRef("proposals"); err == nil || !strings.Contains(err.Error(), "MUTABLE_POLICY_REF") {
		return ProofSummary{}, fmt.Errorf("PROOF_MUTABLE_REF_NOT_REJECTED")
	}
	add("mutable-policy-ref", "PASS", "MUTABLE_POLICY_REF")
	wrongCandidate := "git-tree-sha1:" + strings.Repeat("f", 40)
	if wrongCandidate == candidateTree {
		wrongCandidate = "git-tree-sha1:" + strings.Repeat("e", 40)
	}
	if err := VerifyReceiptBinding(r1, b.Hash, baseTree, wrongCandidate); err == nil || !strings.Contains(err.Error(), "CANDIDATE_TREE_MISMATCH") {
		return ProofSummary{}, fmt.Errorf("PROOF_TREE_MISMATCH_NOT_REJECTED: %v", err)
	}
	add("candidate-tree-mismatch", "PASS", "CANDIDATE_TREE_MISMATCH")
	violating := []Observation{}
	for _, o := range positive {
		if o.ProfileID != "javascript.core-imports" {
			violating = append(violating, o)
		}
	}
	for _, o := range all {
		if o.CaseID == "javascript.bad" {
			violating = append(violating, o)
		}
	}
	violatingReceipt, err := Admit(b, policyRef, b.Hash, baseTree, candidateTree, violating)
	if err != nil {
		return ProofSummary{}, err
	}
	if violatingReceipt.Verdict != "BLOCK" || violatingReceipt.TerminalState != "BLOCKED_RULE" || violatingReceipt.Counts.RequiredUnobserved != 0 {
		return ProofSummary{}, fmt.Errorf("PROOF_OBSERVED_UNMET_MISCLASSIFIED: %s/%s requiredUnobserved=%d", violatingReceipt.Verdict, violatingReceipt.TerminalState, violatingReceipt.Counts.RequiredUnobserved)
	}
	add("observed-unmet-is-blocked-rule", "PASS", "BLOCKED_RULE without required-unobserved")
	for _, neg := range []struct{ id, code string }{
		{"missing-tool-not-green", "required-tool-missing"}, {"unsupported-language-not-green", "unsupported-language"}, {"skipped-test-not-green", "skipped-required-test"},
	} {
		obs := append(append([]Observation(nil), positive...), syntheticUnobserved("SL-CORE-001", "javascript.core-imports", neg.code))
		r, err := Admit(b, policyRef, b.Hash, baseTree, candidateTree, obs)
		if err != nil {
			return ProofSummary{}, err
		}
		if r.Verdict == "PASS" || r.TerminalState != "UNSUPPORTED_REQUIRED_ADAPTER" {
			return ProofSummary{}, fmt.Errorf("PROOF_%s_FALSE_GREEN: %s/%s", neg.id, r.Verdict, r.TerminalState)
		}
		add(neg.id, "PASS", r.TerminalState)
	}
	sort.Slice(cases, func(i, j int) bool { return cases[i].ID < cases[j].ID })
	summary := ProofSummary{Schema: "shiftleft-proof-summary/1", Status: "PASS", PolicyRef: policyRef, PolicyHash: b.Hash, BaseTree: baseTree, CandidateTree: candidateTree, ReceiptDigest: r1.ReceiptDigest, SemanticRoot: semanticRoot(positive), ProviderCases: len(all) + len(ruleCases), Cases: cases}
	if err := writeJSON(filepath.Join(outDir, "proof-summary.json"), summary); err != nil {
		return ProofSummary{}, err
	}
	return summary, nil
}
