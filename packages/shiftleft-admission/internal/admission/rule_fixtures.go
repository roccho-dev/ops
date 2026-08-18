package admission

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

var requiredFixtureKinds = []string{"bad", "false-negative", "false-positive", "good"}

func cloneBundle(b *Bundle) (*Bundle, error) {
	data, err := json.Marshal(struct {
		Rules     []Rule            `json:"rules"`
		Contracts []PackageContract `json:"contracts"`
		Profiles  []Profile         `json:"profiles"`
	}{b.Rules, b.Contracts, b.Profiles})
	if err != nil {
		return nil, err
	}
	var v struct {
		Rules     []Rule            `json:"rules"`
		Contracts []PackageContract `json:"contracts"`
		Profiles  []Profile         `json:"profiles"`
	}
	if err := json.Unmarshal(data, &v); err != nil {
		return nil, err
	}
	return &Bundle{Dir: b.Dir, Hash: b.Hash, FileHash: b.FileHash, Rules: v.Rules, Contracts: v.Contracts, Profiles: v.Profiles}, nil
}

func loadRuleFixtures(fixturesDir string) ([]RuleFixture, error) {
	path := filepath.Join(fixturesDir, "rules.jsonl")
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("MISSING_REQUIRED_INPUT: fixtures/rules.jsonl")
		}
		return nil, err
	}
	rows, err := parseJSONL[RuleFixture](path, data)
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	for _, f := range rows {
		if f.Schema != "shiftleft-rule-fixture/1" || !nonblank(f.CaseID) || !nonblank(f.RuleID) || !nonblank(f.FixtureKind) || !validStatus(f.ExpectedStatus) || !nonblank(f.Scenario) {
			return nil, fmt.Errorf("RULE_FIXTURE_INVALID: %+v", f)
		}
		if seen[f.CaseID] {
			return nil, fmt.Errorf("RULE_FIXTURE_DUPLICATE: %s", f.CaseID)
		}
		seen[f.CaseID] = true
	}
	return rows, nil
}

func firstContract(b *Bundle) (*PackageContract, *PublicContract, error) {
	if len(b.Contracts) == 0 || len(b.Contracts[0].PublicContracts) == 0 {
		return nil, nil, fmt.Errorf("RULE_FIXTURE_CONTRACT_MISSING")
	}
	return &b.Contracts[0], &b.Contracts[0].PublicContracts[0], nil
}

func applyRuleFixtureScenario(b *Bundle, f RuleFixture) error {
	contract, public, err := firstContract(b)
	if err != nil {
		return err
	}
	switch f.Scenario {
	case "parse.good", "contract.good", "golden.good", "yagni.good":
	case "parse.bad-empty-parser":
		contract.ParseBoundary.Parser = ""
	case "parse.false-positive-wording":
		contract.Responsibility = "raw reuse and effect before parse are forbidden, not enabled"
	case "parse.false-negative-raw-reuse":
		contract.ParseBoundary.RawReuseAllowed = true
	case "contract.bad-empty-input":
		public.Input = ""
	case "contract.false-positive-wording":
		contract.Responsibility = "documentation mentions missing input while the structured contract remains complete"
	case "contract.false-negative-whitespace-effect":
		public.Effect = "   "
	case "golden.bad-missing-golden":
		public.GoldenRoutes = nil
	case "golden.false-positive-wording":
		public.GoldenRoutes[0].ID = "missing-looking-but-present"
	case "golden.false-negative-inert-negative":
		public.NegativeRoutes[0].Fixture = "   "
		public.NegativeRoutes[0].Expected = ""
		public.NegativeRoutes[0].EffectCount = nil
	case "yagni.bad-no-consumer":
		public.CurrentConsumers = nil
	case "yagni.false-positive-future-word":
		public.CurrentConsumers = []string{"current consumer named future-proof-runner"}
	case "yagni.false-negative-blank-consumer":
		public.CurrentConsumers = []string{"   "}
	default:
		return fmt.Errorf("RULE_FIXTURE_SCENARIO_UNSUPPORTED: %s", f.Scenario)
	}
	return nil
}

func fixtureKindStatus(kinds []string) (string, string, []Evidence) {
	counts := map[string]int{}
	for _, k := range kinds {
		counts[k]++
	}
	missing, duplicates, unknown := []string{}, []string{}, []string{}
	allowed := map[string]bool{}
	for _, k := range requiredFixtureKinds {
		allowed[k] = true
		if counts[k] == 0 {
			missing = append(missing, k)
		}
		if counts[k] > 1 {
			duplicates = append(duplicates, k)
		}
	}
	for k := range counts {
		if !allowed[k] {
			unknown = append(unknown, k)
		}
	}
	sort.Strings(missing)
	sort.Strings(duplicates)
	sort.Strings(unknown)
	if len(missing) == 0 && len(duplicates) == 0 && len(unknown) == 0 && len(kinds) == len(requiredFixtureKinds) {
		return StatusMet, "fixture-matrix-complete", []Evidence{{Kind: "fixture-matrix", Detail: "bad,false-negative,false-positive,good executed exactly once"}}
	}
	return StatusUnmet, "fixture-matrix-incomplete", []Evidence{{Kind: "fixture-matrix", Detail: fmt.Sprintf("missing=%s duplicate=%s unknown=%s total=%d", strings.Join(missing, ","), strings.Join(duplicates, ","), strings.Join(unknown, ","), len(kinds))}}
}

func evaluateRuleFixture(b *Bundle, f RuleFixture) (Observation, error) {
	if f.RuleID == "SL-TEST-001" {
		status, code, evidence := fixtureKindStatus(f.PresentKinds)
		raw, _ := json.Marshal(f)
		o := Observation{Schema: "shiftleft-observation/1", RuleID: f.RuleID, ProfileID: "rule-fixture." + f.RuleID, PackageID: "policy:" + f.RuleID, Language: "language-neutral", Required: true, Status: status, FindingCode: code, FixtureKind: f.FixtureKind, CaseID: f.CaseID, SourcePath: "rules.jsonl", SourceSHA256: "sha256:" + shaHex(raw), ConfigSHA256: "sha256:" + shaHex(raw), Tool: ToolIdentity{Name: "policyctl", Version: "1", AdapterSHA256: "builtin", Digest: "sha256:" + shaHex([]byte("policyctl-rule-fixture-provider/1"))}, Evidence: evidence}
		return finalizeObservation(o)
	}
	copy, err := cloneBundle(b)
	if err != nil {
		return Observation{}, err
	}
	if err := applyRuleFixtureScenario(copy, f); err != nil {
		return Observation{}, err
	}
	observations, err := contractRuleObservations(copy)
	if err != nil {
		return Observation{}, err
	}
	for _, base := range observations {
		if base.RuleID != f.RuleID {
			continue
		}
		raw, _ := json.Marshal(f)
		base.ProfileID = "rule-fixture." + f.RuleID
		base.PackageID = "policy:" + f.RuleID
		base.FixtureKind = f.FixtureKind
		base.CaseID = f.CaseID
		base.SourcePath = "rules.jsonl"
		base.SourceSHA256 = "sha256:" + shaHex(raw)
		base.ConfigSHA256 = "sha256:" + shaHex(raw)
		base.Tool = ToolIdentity{Name: "policyctl", Version: "1", AdapterSHA256: "builtin", Digest: "sha256:" + shaHex([]byte("policyctl-rule-fixture-provider/1"))}
		return finalizeObservation(base)
	}
	return Observation{}, fmt.Errorf("RULE_FIXTURE_OBSERVATION_MISSING: %s", f.RuleID)
}

func requiredProfileCount(b *Bundle, ruleID string) int {
	count := 0
	for _, profile := range b.Profiles {
		if profile.Required && profile.RuleID == ruleID {
			count++
		}
	}
	return count
}

func ObserveRuleFixtures(b *Bundle, fixturesDir string) ([]Observation, []RuleFixture, error) {
	fixtures, err := loadRuleFixtures(fixturesDir)
	if err != nil {
		return nil, nil, err
	}
	out := make([]Observation, 0, len(fixtures))
	for _, f := range fixtures {
		if requiredProfileCount(b, f.RuleID) > 0 {
			return nil, nil, fmt.Errorf("RULE_FIXTURE_PROVIDER_BACKED_MUST_USE_PROFILE_PROVIDER: %s", f.CaseID)
		}
		o, err := evaluateRuleFixture(b, f)
		if err != nil {
			return nil, nil, err
		}
		if o.Status != f.ExpectedStatus {
			return nil, nil, fmt.Errorf("RULE_FIXTURE_MISMATCH: %s got %s want %s", f.CaseID, o.Status, f.ExpectedStatus)
		}
		out = append(out, o)
	}
	return out, fixtures, nil
}

func fixtureCoverageObservation(target Rule, cases []Observation, profileCount int) (Observation, error) {
	byProfile := map[string]map[string]Observation{}
	for _, o := range cases {
		if o.RuleID != target.ID {
			continue
		}
		if byProfile[o.ProfileID] == nil {
			byProfile[o.ProfileID] = map[string]Observation{}
		}
		if _, duplicate := byProfile[o.ProfileID][o.FixtureKind]; duplicate {
			return Observation{}, fmt.Errorf("FIXTURE_KIND_DUPLICATE: %s/%s", o.ProfileID, o.FixtureKind)
		}
		byProfile[o.ProfileID][o.FixtureKind] = o
	}
	status, code := StatusMet, "fixture-matrix-complete"
	evidence := []Evidence{}
	if len(byProfile) != profileCount {
		status, code = StatusUnmet, "fixture-matrix-incomplete"
	}
	profiles := make([]string, 0, len(byProfile))
	for p := range byProfile {
		profiles = append(profiles, p)
	}
	sort.Strings(profiles)
	for _, profile := range profiles {
		got := byProfile[profile]
		for _, kind := range requiredFixtureKinds {
			o, ok := got[kind]
			if !ok {
				status, code = StatusUnmet, "fixture-matrix-incomplete"
				evidence = append(evidence, Evidence{Kind: "fixture-matrix", Detail: profile + " missing " + kind})
				continue
			}
			expected := StatusUnmet
			if kind == "false-positive" || kind == "good" {
				expected = StatusMet
			}
			if o.Status != expected {
				status, code = StatusUnmet, "fixture-matrix-incomplete"
				evidence = append(evidence, Evidence{Kind: "fixture-matrix", Detail: profile + "/" + kind + " got " + o.Status + " want " + expected})
			}
			evidence = append(evidence, Evidence{Kind: "fixture-case", Path: o.CaseID, Detail: o.Status + " " + o.ObservationDigest})
		}
	}
	if status == StatusMet {
		evidence = append(evidence, Evidence{Kind: "fixture-matrix", Detail: fmt.Sprintf("%d profiles and %d executable cases complete", profileCount, len(cases))})
	}
	raw, _ := json.Marshal(evidence)
	o := Observation{Schema: "shiftleft-observation/1", RuleID: "SL-TEST-001", ProfileID: "fixture-matrix." + target.ID, PackageID: "policy:" + target.ID, Language: "language-neutral", Required: true, Status: status, FindingCode: code, ConfigSHA256: "sha256:" + shaHex(raw), Tool: ToolIdentity{Name: "policyctl", Version: "1", AdapterSHA256: "builtin", Digest: "sha256:" + shaHex([]byte("policyctl-fixture-coverage-provider/1"))}, Evidence: evidence}
	return finalizeObservation(o)
}

func FixtureCoverageObservations(b *Bundle, providerCases, ruleCases []Observation) ([]Observation, error) {
	out := []Observation{}
	for _, rule := range b.Rules {
		if rule.Strength != "block" {
			continue
		}
		cases := ruleCases
		profiles := 1
		if count := requiredProfileCount(b, rule.ID); count > 0 {
			cases = providerCases
			profiles = count
		}
		o, err := fixtureCoverageObservation(rule, cases, profiles)
		if err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, nil
}
