package packagedocs

import "encoding/json"

const (
	ContractSchema    = "package-docs-contract/1"
	ObservationSchema = "shiftleft-observation/1"
	RuleIdentity      = "SL-PACKAGE-DOCS-001"
	RuleProjection    = "SL-PACKAGE-DOCS-002"
	RuleDiscovery     = "SL-PACKAGE-DOCS-003"
	RuleDistribution  = "SL-PACKAGE-DOCS-004"
)

type CatalogEntry struct {
	Name    string `json:"name"`
	Runtime string `json:"runtime"`
	Entry   string `json:"entry"`
	Kind    string `json:"kind"`
}

type PublicContract struct {
	ID            string `json:"id"`
	EntryPoint    string `json:"entrypoint"`
	Input         string `json:"input"`
	Output        string `json:"output"`
	Error         string `json:"error"`
	Effect        string `json:"effect"`
	Compatibility string `json:"compatibility"`
}

type InternalContract struct {
	ID               string   `json:"id"`
	Boundary         string   `json:"boundary"`
	Invariants       []string `json:"invariants"`
	ForbiddenEffects []string `json:"forbiddenEffects"`
}

type Document struct {
	ID       string `json:"id"`
	Kind     string `json:"kind"` // contract-projection or authored
	Title    string `json:"title"`
	Path     string `json:"path"`
	Required bool   `json:"required"`
}

type CommandRoute struct {
	ID       string   `json:"id"`
	Required bool     `json:"required"`
	WorkDir  string   `json:"workdir,omitempty"`
	Argv     []string `json:"argv"`
	Contains []string `json:"contains,omitempty"`
	Document string   `json:"document,omitempty"`
}

type Projection struct {
	ID       string `json:"id"`
	Required bool   `json:"required"`
	Surface  string `json:"surface"` // named --surface root
	Path     string `json:"path"`
	Document string `json:"document"`
}

type PackageContract struct {
	Schema            string             `json:"schema"`
	PackageID         string             `json:"packageId"`
	OwnerRoot         string             `json:"ownerRoot"`
	Kind              string             `json:"kind"`
	Responsibility    string             `json:"responsibility"`
	ExternalContracts []PublicContract   `json:"externalContracts"`
	InternalContracts []InternalContract `json:"internalContracts"`
	Documents         []Document         `json:"documents"`
	DiscoverRoutes    []CommandRoute     `json:"discoverRoutes,omitempty"`
	ContentRoutes     []CommandRoute     `json:"contentRoutes,omitempty"`
	Projections       []Projection       `json:"projections,omitempty"`
	CurrentConsumers  []string           `json:"currentConsumers"`
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

type SurfaceRoots map[string]string

func (s *SurfaceRoots) Set(v string) error { return setSurfaceRoot(*s, v) }
func (s *SurfaceRoots) String() string     { b, _ := json.Marshal(*s); return string(b) }
