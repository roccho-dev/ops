package admission

import (
	"fmt"
	"sort"
	"strings"
)

func ruleMap(b *Bundle) map[string]Rule {
	out := map[string]Rule{}
	for _, r := range b.Rules {
		out[r.ID] = r
	}
	return out
}

func terminalFromFindings(findings []Finding) string {
	for _, f := range findings {
		if f.Status == StatusUnobserved && (strings.Contains(f.FindingCode, "tool") || strings.Contains(f.FindingCode, "unsupported") || strings.Contains(f.FindingCode, "skipped")) {
			return "UNSUPPORTED_REQUIRED_ADAPTER"
		}
	}
	for _, f := range findings {
		if f.FindingCode == "public-contract-incomplete" || f.FindingCode == "parse-boundary-incomplete" {
			return "BLOCKED_PACKAGE_CONTRACT"
		}
	}
	for _, f := range findings {
		if f.FindingCode == "golden-route-missing" {
			return "BLOCKED_GOLDEN_ROUTE"
		}
	}
	for _, f := range findings {
		if f.FindingCode == "fixture-matrix-incomplete" {
			return "BLOCKED_TEST_EVIDENCE"
		}
	}
	return "BLOCKED_RULE"
}

func Admit(b *Bundle, policyRef, expectedPolicyHash, baseTree, candidateTree string, observations []Observation) (Receipt, error) {
	if err := ValidateExactPolicyRef(policyRef); err != nil {
		return Receipt{}, err
	}
	if b.Hash != expectedPolicyHash {
		return Receipt{}, fmt.Errorf("POLICY_HASH_MISMATCH: expected %s got %s", expectedPolicyHash, b.Hash)
	}
	if err := ValidateTreeRef(baseTree); err != nil {
		return Receipt{}, err
	}
	if err := ValidateTreeRef(candidateTree); err != nil {
		return Receipt{}, err
	}
	rm := ruleMap(b)
	profileSeen := map[string]bool{}
	for _, o := range observations {
		if o.ProfileID != "internal.contract" && o.Status != StatusUnobserved {
			profileSeen[o.ProfileID] = true
		}
	}
	for _, p := range b.Profiles {
		if p.Required && !profileSeen[p.ID] {
			o, err := finalizeObservation(Observation{Schema: "shiftleft-observation/1", RuleID: p.RuleID, ProfileID: p.ID, PackageID: "<required-profile>", Language: p.Language, Required: true, Status: StatusUnobserved, FindingCode: "required-profile-unobserved", ConfigSHA256: "sha256:" + shaHex([]byte(p.ID)), Tool: ToolIdentity{Name: p.Tool}, Evidence: []Evidence{{Kind: "coverage", Detail: "required profile has no met observation"}}})
			if err != nil {
				return Receipt{}, err
			}
			observations = append(observations, o)
		}
	}
	counts := Counts{}
	findings := []Finding{}
	for _, o := range observations {
		if !validStatus(o.Status) {
			return Receipt{}, fmt.Errorf("OBSERVATION_STATUS_INVALID: %s", o.Status)
		}
		r, ok := rm[o.RuleID]
		if !ok {
			return Receipt{}, fmt.Errorf("OBSERVATION_UNKNOWN_RULE: %s", o.RuleID)
		}
		switch o.Status {
		case StatusMet:
			counts.Met++
		case StatusUnmet:
			counts.Unmet++
		case StatusUnobserved:
			counts.Unobserved++
			if o.Required {
				counts.RequiredUnobserved++
			}
		case StatusNotApplicable:
			counts.NotApplicable++
		}
		blocks := r.Strength == "block" && (o.Status == StatusUnmet || (o.Required && o.Status == StatusUnobserved))
		if blocks {
			counts.BlockerCount++
			if o.Status == StatusUnobserved {
				counts.UnsupportedRequired++
			}
			findings = append(findings, Finding{RuleID: o.RuleID, ProfileID: o.ProfileID, PackageID: o.PackageID, Language: o.Language, Status: o.Status, FindingCode: o.FindingCode, CaseID: o.CaseID})
		}
		if r.Strength == "review" && (o.Status == StatusUnmet || o.Status == StatusUnobserved) {
			counts.ReviewCount++
			findings = append(findings, Finding{RuleID: o.RuleID, ProfileID: o.ProfileID, PackageID: o.PackageID, Language: o.Language, Status: o.Status, FindingCode: o.FindingCode, CaseID: o.CaseID})
		}
	}
	verdict, terminal := "PASS", "PASS"
	if counts.BlockerCount > 0 {
		verdict = "BLOCK"
		terminal = terminalFromFindings(findings)
	} else if counts.ReviewCount > 0 {
		verdict = "REVIEW"
		terminal = "REVIEW_REQUIRED"
	}
	r := Receipt{Schema: "shiftleft-receipt/1", Verdict: verdict, TerminalState: terminal, PolicyRef: policyRef, PolicyHash: b.Hash, RuleDigest: b.FileHash["rules.jsonl"], ContractDigest: b.FileHash["contracts.jsonl"], ProfileDigest: b.FileHash["profiles.jsonl"], BaseTree: baseTree, CandidateTree: candidateTree, ObservationRootDigest: observationRoot(observations), Counts: counts, Findings: findings}
	return finalizeReceipt(r)
}

func VerifyReceiptBinding(r Receipt, policyHash, baseTree, candidateTree string) error {
	if err := validateReceiptDigest(r); err != nil {
		return err
	}
	if r.PolicyHash != policyHash {
		return fmt.Errorf("POLICY_HASH_MISMATCH: receipt=%s expected=%s", r.PolicyHash, policyHash)
	}
	if r.BaseTree != baseTree {
		return fmt.Errorf("BASE_TREE_MISMATCH: receipt=%s expected=%s", r.BaseTree, baseTree)
	}
	if r.CandidateTree != candidateTree {
		return fmt.Errorf("CANDIDATE_TREE_MISMATCH: receipt=%s expected=%s", r.CandidateTree, candidateTree)
	}
	return nil
}

func semanticRoot(observations []Observation) string {
	rows := []string{}
	for _, o := range observations {
		rows = append(rows, strings.Join([]string{o.RuleID, o.ProfileID, o.PackageID, o.Language, o.Status, o.FindingCode, o.FixtureKind}, "\x00"))
	}
	sort.Strings(rows)
	return "sha256:" + shaHex([]byte("shiftleft-semantic-root/1\n"+strings.Join(rows, "\n")+"\n"))
}
