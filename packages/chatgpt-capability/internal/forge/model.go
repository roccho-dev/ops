package forge

import "time"

const (
	DecisionSchema       = "capability-decision/1"
	ImplementationSchema = "capability-implementation/1"
	RegistrySchema       = "capability-registry/1"
	BootstrapSchema      = "capforge-bootstrap/1"
	BuildSchema          = "capforge-build/1"
	FixtureSchema        = "go-stdout-fixture/1"
	ProjectionSchema     = "capability-projection/1"
	ProtocolVersion      = "v1"
)

type DecisionClaim struct {
	Schema    string   `json:"schema"`
	ID        string   `json:"id"`
	Action    string   `json:"action"`
	Title     string   `json:"title,omitempty"`
	Purpose   string   `json:"purpose,omitempty"`
	At        string   `json:"at,omitempty"`
	Execution string   `json:"execution,omitempty"`
	Effects   []string `json:"effects,omitempty"`
	Tags      []string `json:"tags,omitempty"`
}

type Fixture struct {
	Schema    string   `json:"schema"`
	Args      []string `json:"args"`
	Stdin     string   `json:"stdin"`
	Stdout    string   `json:"stdout"`
	Stderr    string   `json:"stderr"`
	ExitCode  int      `json:"exitCode"`
	TimeoutMS int      `json:"timeoutMs"`
}

type FixtureResult struct {
	Status   string `json:"status"`
	Stdout   string `json:"stdout,omitempty"`
	Stderr   string `json:"stderr,omitempty"`
	ExitCode int    `json:"exitCode"`
	Error    string `json:"error,omitempty"`
}

type ProjectionSpec struct {
	Schema    string   `json:"schema"`
	Inputs    []string `json:"inputs,omitempty"`
	Args      []string `json:"args"`
	Outputs   []string `json:"outputs"`
	TimeoutMS int      `json:"timeoutMs"`
}

type ProjectionResult struct {
	Status  string            `json:"status"`
	Inputs  map[string]string `json:"inputs,omitempty"`
	Outputs map[string]string `json:"outputs,omitempty"`
	Stdout  string            `json:"stdout,omitempty"`
	Stderr  string            `json:"stderr,omitempty"`
	Error   string            `json:"error,omitempty"`
}

type ImplementationClaim struct {
	Schema        string            `json:"schema"`
	ID            string            `json:"id"`
	At            string            `json:"at"`
	Language      string            `json:"language"`
	Kind          string            `json:"kind"`
	Target        string            `json:"target"`
	SourceDigest  string            `json:"sourceDigest,omitempty"`
	PayloadSHA256 string            `json:"payloadSha256,omitempty"`
	PayloadBytes  int64             `json:"payloadBytes,omitempty"`
	CarrierPath   string            `json:"carrierPath,omitempty"`
	RawPath       string            `json:"rawPath,omitempty"`
	BuildStatus   string            `json:"buildStatus"`
	Fixture       *Fixture          `json:"fixture,omitempty"`
	FixtureResult *FixtureResult    `json:"fixtureResult,omitempty"`
	Projection    *ProjectionResult `json:"projection,omitempty"`
	Cache         string            `json:"cache,omitempty"`
	Error         string            `json:"error,omitempty"`
}

type RegistryRecord struct {
	Schema         string               `json:"schema"`
	ID             string               `json:"id"`
	Status         string               `json:"status"`
	Title          string               `json:"title,omitempty"`
	Purpose        string               `json:"purpose,omitempty"`
	Tags           []string             `json:"tags,omitempty"`
	SearchText     string               `json:"searchText"`
	Decision       *DecisionClaim       `json:"decision,omitempty"`
	Implementation *ImplementationClaim `json:"implementation,omitempty"`
	Issues         []string             `json:"issues,omitempty"`
}

type ArtifactRef struct {
	Kind          string `json:"kind"`
	Target        string `json:"target"`
	PayloadSHA256 string `json:"payloadSha256"`
	PayloadBytes  int64  `json:"payloadBytes"`
	CarrierPath   string `json:"carrierPath"`
	RawPath       string `json:"rawPath,omitempty"`
}

type SourceKitRef struct {
	SHA256      string `json:"sha256"`
	Bytes       int64  `json:"bytes"`
	RawPath     string `json:"rawPath"`
	CarrierPath string `json:"carrierPath"`
}

type Bootstrap struct {
	Schema      string                 `json:"schema"`
	Protocol    map[string]any         `json:"protocol"`
	Entrypoints map[string]string      `json:"entrypoints"`
	Capforge    ArtifactRef            `json:"capforge"`
	Search      ArtifactRef            `json:"search"`
	SourceKit   SourceKitRef           `json:"sourceKit"`
	Release     ReleaseNaming          `json:"release"`
	Workflow    []map[string]any       `json:"workflow"`
	Limits      map[string]int64       `json:"limits"`
	Facts       map[string]interface{} `json:"facts"`
}

type BuildReceipt struct {
	Schema              string            `json:"schema"`
	Status              string            `json:"status"`
	GeneratedAt         string            `json:"generatedAt"`
	GoVersion           string            `json:"goVersion"`
	Root                string            `json:"root"`
	Dist                string            `json:"dist"`
	DecisionCount       int               `json:"decisionCount"`
	ImplementationCount int               `json:"implementationCount"`
	RegistryCount       int               `json:"registryCount"`
	ActiveCount         int               `json:"activeCount"`
	BuiltCount          int               `json:"builtCount"`
	ReusedCount         int               `json:"reusedCount"`
	ProjectionCount     int               `json:"projectionCount"`
	Statuses            map[string]int    `json:"statuses"`
	Artifacts           map[string]string `json:"artifacts"`
	DistFiles           map[string]string `json:"distFiles"`
	Warnings            []string          `json:"warnings,omitempty"`
	Errors              []string          `json:"errors,omitempty"`
}

func newBuildReceipt() BuildReceipt {
	return BuildReceipt{
		Schema:      BuildSchema,
		Status:      "PASS",
		GeneratedAt: time.Unix(0, 0).UTC().Format(time.RFC3339),
		Statuses:    map[string]int{},
		Artifacts:   map[string]string{},
		DistFiles:   map[string]string{},
	}
}
