package admission

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

const (
	StatusMet           = "met"
	StatusUnmet         = "unmet"
	StatusUnobserved    = "unobserved"
	StatusNotApplicable = "not-applicable"
)

type Rule struct {
	Schema           string   `json:"schema"`
	ID               string   `json:"id"`
	Principle        string   `json:"principle"`
	Strength         string   `json:"strength"`
	Claim            string   `json:"claim"`
	RequiredEvidence []string `json:"requiredEvidence"`
	FixtureKinds     []string `json:"fixtureKinds"`
}

type Route struct {
	ID          string `json:"id"`
	Fixture     string `json:"fixture"`
	Expected    string `json:"expected"`
	EffectCount *int   `json:"effectCount,omitempty"`
}

type PublicContract struct {
	ID               string   `json:"id"`
	EntryPoint       string   `json:"entrypoint"`
	Input            string   `json:"input"`
	Output           string   `json:"output"`
	Error            string   `json:"error"`
	Effect           string   `json:"effect"`
	Determinism      string   `json:"determinism"`
	GoldenRoutes     []Route  `json:"goldenRoutes"`
	NegativeRoutes   []Route  `json:"negativeRoutes"`
	CurrentConsumers []string `json:"currentConsumers"`
}

type ParseBoundary struct {
	RawInput                 string `json:"rawInput"`
	ParsedInput              string `json:"parsedInput"`
	Parser                   string `json:"parser"`
	EffectBeforeParseAllowed bool   `json:"effectBeforeParseAllowed"`
	RawReuseAllowed          bool   `json:"rawReuseAllowed"`
}

type PackageContract struct {
	Schema          string           `json:"schema"`
	PackageID       string           `json:"packageId"`
	Responsibility  string           `json:"responsibility"`
	ParseBoundary   ParseBoundary    `json:"parseBoundary"`
	PublicContracts []PublicContract `json:"publicContracts"`
}

type Profile struct {
	Schema           string   `json:"schema"`
	ID               string   `json:"id"`
	RuleID           string   `json:"ruleId"`
	Language         string   `json:"language"`
	Provider         string   `json:"provider"`
	Adapter          string   `json:"adapter"`
	Tool             string   `json:"tool"`
	Required         bool     `json:"required"`
	ForbiddenImports []string `json:"forbiddenImports"`
}

type Fixture struct {
	Schema              string `json:"schema"`
	CaseID              string `json:"caseId"`
	PackageID           string `json:"packageId"`
	ProfileID           string `json:"profileId"`
	RuleID              string `json:"ruleId"`
	Language            string `json:"language"`
	FixtureKind         string `json:"fixtureKind"`
	Source              string `json:"source"`
	ExpectedStatus      string `json:"expectedStatus"`
	ExpectedFindingCode string `json:"expectedFindingCode"`
}

type RuleFixture struct {
	Schema         string   `json:"schema"`
	CaseID         string   `json:"caseId"`
	RuleID         string   `json:"ruleId"`
	FixtureKind    string   `json:"fixtureKind"`
	ExpectedStatus string   `json:"expectedStatus"`
	Scenario       string   `json:"scenario"`
	PresentKinds   []string `json:"presentKinds,omitempty"`
}

type ImportFinding struct {
	Module string `json:"module"`
	Line   int    `json:"line"`
}

type ImportReport struct {
	Schema  string          `json:"schema"`
	Imports []ImportFinding `json:"imports"`
}

type ToolIdentity struct {
	Name          string `json:"name"`
	Version       string `json:"version"`
	AdapterSHA256 string `json:"adapterSha256"`
	Digest        string `json:"digest"`
}

type Evidence struct {
	Kind   string `json:"kind"`
	Path   string `json:"path,omitempty"`
	Line   int    `json:"line,omitempty"`
	Detail string `json:"detail"`
}

type Observation struct {
	Schema            string       `json:"schema"`
	RuleID            string       `json:"ruleId"`
	ProfileID         string       `json:"profileId"`
	PackageID         string       `json:"packageId"`
	Language          string       `json:"language"`
	Required          bool         `json:"required"`
	Status            string       `json:"status"`
	FindingCode       string       `json:"findingCode"`
	FixtureKind       string       `json:"fixtureKind,omitempty"`
	CaseID            string       `json:"caseId,omitempty"`
	SourcePath        string       `json:"sourcePath,omitempty"`
	SourceSHA256      string       `json:"sourceSha256,omitempty"`
	ConfigSHA256      string       `json:"configSha256"`
	Tool              ToolIdentity `json:"tool"`
	Evidence          []Evidence   `json:"evidence"`
	ObservationDigest string       `json:"observationDigest"`
}

type Finding struct {
	RuleID      string `json:"ruleId"`
	ProfileID   string `json:"profileId"`
	PackageID   string `json:"packageId"`
	Language    string `json:"language"`
	Status      string `json:"status"`
	FindingCode string `json:"findingCode"`
	CaseID      string `json:"caseId,omitempty"`
}

type Counts struct {
	Met                 int `json:"met"`
	Unmet               int `json:"unmet"`
	Unobserved          int `json:"unobserved"`
	NotApplicable       int `json:"notApplicable"`
	RequiredUnobserved  int `json:"requiredUnobserved"`
	BlockerCount        int `json:"blockerCount"`
	ReviewCount         int `json:"reviewCount"`
	UnsupportedRequired int `json:"unsupportedRequiredCount"`
}

type Receipt struct {
	Schema                string    `json:"schema"`
	Verdict               string    `json:"verdict"`
	TerminalState         string    `json:"terminalState"`
	PolicyRef             string    `json:"policyRef"`
	PolicyHash            string    `json:"policyHash"`
	RuleDigest            string    `json:"ruleDigest"`
	ContractDigest        string    `json:"contractDigest"`
	ProfileDigest         string    `json:"profileDigest"`
	BaseTree              string    `json:"baseTree"`
	CandidateTree         string    `json:"candidateTree"`
	ObservationRootDigest string    `json:"observationRootDigest"`
	Counts                Counts    `json:"counts"`
	Findings              []Finding `json:"findings"`
	ReceiptDigest         string    `json:"receiptDigest"`
}

type ProofCase struct {
	ID       string `json:"id"`
	Status   string `json:"status"`
	Observed string `json:"observed"`
}

type ProofSummary struct {
	Schema        string      `json:"schema"`
	Status        string      `json:"status"`
	PolicyRef     string      `json:"policyRef"`
	PolicyHash    string      `json:"policyHash"`
	BaseTree      string      `json:"baseTree"`
	CandidateTree string      `json:"candidateTree"`
	ReceiptDigest string      `json:"receiptDigest"`
	SemanticRoot  string      `json:"semanticRoot"`
	ProviderCases int         `json:"providerCases"`
	Cases         []ProofCase `json:"cases"`
}

func validStatus(s string) bool {
	switch s {
	case StatusMet, StatusUnmet, StatusUnobserved, StatusNotApplicable:
		return true
	default:
		return false
	}
}

func shaHex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func canonicalJSON(v any) ([]byte, error) {
	return json.Marshal(v)
}

func digestWithPrefix(prefix string, v any) (string, error) {
	data, err := canonicalJSON(v)
	if err != nil {
		return "", err
	}
	return "sha256:" + shaHex(append([]byte(prefix+"\n"), data...)), nil
}

func finalizeObservation(o Observation) (Observation, error) {
	o.ObservationDigest = ""
	sort.Slice(o.Evidence, func(i, j int) bool {
		a, b := o.Evidence[i], o.Evidence[j]
		if a.Kind != b.Kind {
			return a.Kind < b.Kind
		}
		if a.Path != b.Path {
			return a.Path < b.Path
		}
		if a.Line != b.Line {
			return a.Line < b.Line
		}
		return a.Detail < b.Detail
	})
	d, err := digestWithPrefix("shiftleft-observation/1", o)
	if err != nil {
		return Observation{}, err
	}
	o.ObservationDigest = d
	return o, nil
}

func observationRoot(observations []Observation) string {
	digests := make([]string, 0, len(observations))
	for _, o := range observations {
		digests = append(digests, o.ObservationDigest)
	}
	sort.Strings(digests)
	return "sha256:" + shaHex([]byte("shiftleft-observation-root/1\n"+strings.Join(digests, "\n")+"\n"))
}

func finalizeReceipt(r Receipt) (Receipt, error) {
	r.ReceiptDigest = ""
	sort.Slice(r.Findings, func(i, j int) bool {
		a, b := r.Findings[i], r.Findings[j]
		if a.RuleID != b.RuleID {
			return a.RuleID < b.RuleID
		}
		if a.ProfileID != b.ProfileID {
			return a.ProfileID < b.ProfileID
		}
		if a.PackageID != b.PackageID {
			return a.PackageID < b.PackageID
		}
		if a.Language != b.Language {
			return a.Language < b.Language
		}
		if a.Status != b.Status {
			return a.Status < b.Status
		}
		if a.FindingCode != b.FindingCode {
			return a.FindingCode < b.FindingCode
		}
		return a.CaseID < b.CaseID
	})
	d, err := digestWithPrefix("shiftleft-receipt/1", r)
	if err != nil {
		return Receipt{}, err
	}
	r.ReceiptDigest = d
	return r, nil
}

func validateReceiptDigest(r Receipt) error {
	got := r.ReceiptDigest
	r.ReceiptDigest = ""
	d, err := digestWithPrefix("shiftleft-receipt/1", r)
	if err != nil {
		return err
	}
	if got != d {
		return fmt.Errorf("RECEIPT_DIGEST_MISMATCH: expected %s got %s", got, d)
	}
	return nil
}
