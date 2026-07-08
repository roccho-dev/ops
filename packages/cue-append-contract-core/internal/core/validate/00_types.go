package validate

const GoGeneratorID = "go/internal/core/validate.v0.1"

// Event is the common in-memory representation for append-only contract JSONL rows.
type Event map[string]any

type Result struct {
	Ledger             string              `json:"ledger"`
	Meta               string              `json:"meta"`
	StartedAt          string              `json:"started_at"`
	DurationMS         int64               `json:"duration_ms"`
	Lines              int                 `json:"lines"`
	CueChecked         int                 `json:"cue_checked"`
	CueErrors          []string            `json:"cue_errors"`
	SemanticErrors     []string            `json:"semantic_errors"`
	CountsByKind       map[string]int      `json:"counts_by_kind"`
	Schemas            int                 `json:"schemas"`
	Fields             int                 `json:"fields"`
	Edges              int                 `json:"edges"`
	Queries            int                 `json:"queries"`
	Fixtures           int                 `json:"fixtures"`
	DeprecatedFields   int                 `json:"deprecated_fields"`
	AffectedQueries    map[string][]string `json:"affected_queries_by_field"`
	AffectedFixtures   map[string][]string `json:"affected_fixtures_by_field"`
	UnresolvedAffected map[string][]string `json:"unresolved_affected_active_query_families"`
	PeakAllocMB        float64             `json:"peak_alloc_mb"`
	InputSHA256        string              `json:"input_sha256"`
	ReportSHA256       string              `json:"report_sha256,omitempty"`
	RowValidator       string              `json:"row_validator"`
	FastChecked        int                 `json:"fast_checked"`
	CueSampled         int                 `json:"cue_sampled"`
	Notes              []string            `json:"notes"`
}

type Index struct {
	Events         map[string]int
	Schemas        map[string]bool
	Fields         map[string]map[string]Field
	Deprecated     map[string]string
	Edges          []Edge
	Queries        map[string]Query
	ActiveByFamily map[string]Query
	Fixtures       map[string]Fixture
	Counts         map[string]int
	AuthorityRules []Event
}

type Field struct {
	SchemaID    string
	FieldID     string
	FieldType   string
	Required    bool
	PII         bool
	Description string
	EnumValues  []string
}

type Edge struct {
	Kind            string
	From            string
	To              string
	AcyclicRequired bool
}

type Query struct {
	ID       string
	Family   string
	Inputs   []string
	Output   string
	Fixtures []string
	Line     int
}

type Fixture struct {
	ID      string
	QueryID string
	Line    int
}

type ValidateOptions struct {
	MetaPath     string
	LedgerPath   string
	ReportPath   string
	RowValidator string
	CueSample    int
}

type GenerateOptions struct {
	OutPath  string
	Schemas  int
	Fields   int
	Queries  int
	Edges    int
	Fixtures bool
}

func NewIndex() Index {
	return Index{
		Events: map[string]int{}, Schemas: map[string]bool{}, Fields: map[string]map[string]Field{},
		Deprecated: map[string]string{}, Queries: map[string]Query{}, ActiveByFamily: map[string]Query{},
		Fixtures: map[string]Fixture{}, Counts: map[string]int{}, AuthorityRules: []Event{},
	}
}
