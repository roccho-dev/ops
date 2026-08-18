package admission

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

var exactCommitRE = regexp.MustCompile(`^[0-9a-f]{40}$`)
var treeRE = regexp.MustCompile(`^(git-tree-sha1:[0-9a-f]{40}|sha256-tree:[0-9a-f]{64})$`)

type Bundle struct {
	Dir       string
	Hash      string
	FileHash  map[string]string
	Rules     []Rule
	Contracts []PackageContract
	Profiles  []Profile
}

func parseJSONL[T any](path string, data []byte) ([]T, error) {
	scanner := bufio.NewScanner(bytes.NewReader(data))
	scanner.Buffer(make([]byte, 1024), 4*1024*1024)
	out := []T{}
	line := 0
	for scanner.Scan() {
		line++
		raw := bytes.TrimSpace(scanner.Bytes())
		if len(raw) == 0 {
			continue
		}
		var v T
		if err := json.Unmarshal(raw, &v); err != nil {
			return nil, fmt.Errorf("POLICY_PARSE_ERROR: %s:%d: %w", path, line, err)
		}
		out = append(out, v)
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("POLICY_READ_ERROR: %s: %w", path, err)
	}
	return out, nil
}

func LoadBundle(dir string) (*Bundle, error) {
	required := []string{"contracts.jsonl", "profiles.jsonl", "rules.jsonl"}
	fileHash := map[string]string{}
	raw := map[string][]byte{}
	for _, name := range required {
		path := filepath.Join(dir, name)
		data, err := os.ReadFile(path)
		if err != nil {
			if os.IsNotExist(err) {
				return nil, fmt.Errorf("MISSING_REQUIRED_INPUT: %s", name)
			}
			return nil, fmt.Errorf("POLICY_READ_ERROR: %s: %w", name, err)
		}
		raw[name] = data
		fileHash[name] = "sha256:" + shaHex(data)
	}
	lines := []string{"shiftleft-policy-bundle/1"}
	for _, name := range required {
		lines = append(lines, fmt.Sprintf("%s\x00%d\x00%s", name, len(raw[name]), fileHash[name]))
	}
	hash := "sha256:" + shaHex([]byte(strings.Join(lines, "\n")+"\n"))
	rules, err := parseJSONL[Rule]("rules.jsonl", raw["rules.jsonl"])
	if err != nil {
		return nil, err
	}
	contracts, err := parseJSONL[PackageContract]("contracts.jsonl", raw["contracts.jsonl"])
	if err != nil {
		return nil, err
	}
	profiles, err := parseJSONL[Profile]("profiles.jsonl", raw["profiles.jsonl"])
	if err != nil {
		return nil, err
	}
	b := &Bundle{Dir: dir, Hash: hash, FileHash: fileHash, Rules: rules, Contracts: contracts, Profiles: profiles}
	if err := b.validate(); err != nil {
		return nil, err
	}
	return b, nil
}

func (b *Bundle) validate() error {
	if len(b.Rules) == 0 || len(b.Contracts) == 0 || len(b.Profiles) == 0 {
		return fmt.Errorf("POLICY_EMPTY: rules=%d contracts=%d profiles=%d", len(b.Rules), len(b.Contracts), len(b.Profiles))
	}
	ruleIDs := map[string]bool{}
	for _, r := range b.Rules {
		if r.ID == "" || r.Claim == "" || r.Strength == "" {
			return fmt.Errorf("POLICY_RULE_INVALID: %+v", r)
		}
		if ruleIDs[r.ID] {
			return fmt.Errorf("POLICY_DUPLICATE_RULE: %s", r.ID)
		}
		ruleIDs[r.ID] = true
		if r.Strength != "block" && r.Strength != "review" && r.Strength != "observe" {
			return fmt.Errorf("POLICY_RULE_STRENGTH_INVALID: %s", r.ID)
		}
	}
	profileIDs := map[string]bool{}
	for _, p := range b.Profiles {
		if p.ID == "" || p.RuleID == "" || p.Language == "" || p.Provider == "" {
			return fmt.Errorf("POLICY_PROFILE_INVALID: %+v", p)
		}
		if profileIDs[p.ID] {
			return fmt.Errorf("POLICY_DUPLICATE_PROFILE: %s", p.ID)
		}
		if !ruleIDs[p.RuleID] {
			return fmt.Errorf("POLICY_PROFILE_UNKNOWN_RULE: %s -> %s", p.ID, p.RuleID)
		}
		profileIDs[p.ID] = true
	}
	packageIDs := map[string]bool{}
	for _, c := range b.Contracts {
		if c.PackageID == "" || c.Responsibility == "" {
			return fmt.Errorf("POLICY_CONTRACT_INVALID: %+v", c)
		}
		if packageIDs[c.PackageID] {
			return fmt.Errorf("POLICY_DUPLICATE_PACKAGE_CONTRACT: %s", c.PackageID)
		}
		packageIDs[c.PackageID] = true
	}
	return nil
}

func ValidateExactPolicyRef(ref string) error {
	if !exactCommitRE.MatchString(ref) {
		return fmt.Errorf("MUTABLE_POLICY_REF: exact 40-hex commit required, got %q", ref)
	}
	return nil
}

func ValidateTreeRef(ref string) error {
	if !treeRE.MatchString(ref) {
		return fmt.Errorf("TREE_REF_INVALID: %q", ref)
	}
	return nil
}

func VerifyBundle(dir, policyRef, expectedHash string) (*Bundle, error) {
	if err := ValidateExactPolicyRef(policyRef); err != nil {
		return nil, err
	}
	b, err := LoadBundle(dir)
	if err != nil {
		return nil, err
	}
	if b.Hash != expectedHash {
		return nil, fmt.Errorf("POLICY_HASH_MISMATCH: expected %s got %s", expectedHash, b.Hash)
	}
	return b, nil
}

func writeJSON(path string, v any) error {
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	return os.WriteFile(path, data, 0o644)
}

func writeJSONL(path string, values []Observation) error {
	sort.Slice(values, func(i, j int) bool {
		if values[i].RuleID != values[j].RuleID {
			return values[i].RuleID < values[j].RuleID
		}
		if values[i].ProfileID != values[j].ProfileID {
			return values[i].ProfileID < values[j].ProfileID
		}
		return values[i].CaseID < values[j].CaseID
	})
	var out bytes.Buffer
	enc := json.NewEncoder(&out)
	enc.SetEscapeHTML(false)
	for _, v := range values {
		if err := enc.Encode(v); err != nil {
			return err
		}
	}
	return os.WriteFile(path, out.Bytes(), 0o644)
}

func readObservations(path string) ([]Observation, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	observations, err := parseJSONL[Observation](path, data)
	if err != nil {
		return nil, err
	}
	for i := range observations {
		if !validStatus(observations[i].Status) {
			return nil, fmt.Errorf("OBSERVATION_STATUS_INVALID: %s", observations[i].Status)
		}
		got := observations[i].ObservationDigest
		tmp := observations[i]
		tmp.ObservationDigest = ""
		finalized, err := finalizeObservation(tmp)
		if err != nil {
			return nil, err
		}
		if got != finalized.ObservationDigest {
			return nil, fmt.Errorf("OBSERVATION_DIGEST_MISMATCH: %s", observations[i].CaseID)
		}
	}
	return observations, nil
}
