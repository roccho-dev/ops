package main

import "encoding/json"

const (
	validatorVersion = "contract-schema-validator/1"
	metaVersion      = "contract.meta.v1"
	reportSchema     = "contract-validation-report/1"
)

type commonEvent struct {
	EventID       string `json:"event_id"`
	SchemaVersion string `json:"schema_version"`
	CreatedAt     string `json:"created_at"`
	PurposeLevel  string `json:"purpose_level"`
	Authority     string `json:"authority"`
	Kind          string `json:"kind"`
}

type schemaEvent struct {
	commonEvent
	SchemaID  string `json:"schema_id"`
	Title     string `json:"title"`
	Lifecycle string `json:"lifecycle"`
}

type fieldEvent struct {
	commonEvent
	SchemaID    string   `json:"schema_id"`
	FieldID     string   `json:"field_id"`
	FieldType   string   `json:"field_type"`
	Required    bool     `json:"required"`
	PII         bool     `json:"pii"`
	Description string   `json:"description"`
	EnumValues  []string `json:"enum_values,omitempty"`
	RefSchema   string   `json:"ref_schema,omitempty"`
}

type fieldDeprecatedEvent struct {
	commonEvent
	SchemaID            string `json:"schema_id"`
	FieldID             string `json:"field_id"`
	Reason              string `json:"reason"`
	ReplacementFieldRef string `json:"replacement_field_ref,omitempty"`
}

type edgeEvent struct {
	commonEvent
	EdgeKind        string `json:"edge_kind"`
	FromSchema      string `json:"from_schema"`
	ToSchema        string `json:"to_schema"`
	Cardinality     string `json:"cardinality"`
	AcyclicRequired bool   `json:"acyclic_required"`
}

type queryEvent struct {
	commonEvent
	QueryID            string   `json:"query_id"`
	QueryFamily        string   `json:"query_family"`
	InputFields        []string `json:"input_fields"`
	OutputSchema       string   `json:"output_schema"`
	RunnerKind         string   `json:"runner_kind"`
	ProjectionOnly     bool     `json:"projection_only"`
	SideEffects        bool     `json:"side_effects"`
	FixtureIDs         []string `json:"fixture_ids"`
	ExpectedOutputHash string   `json:"expected_output_hash"`
}

type fixtureEvent struct {
	commonEvent
	FixtureID     string `json:"fixture_id"`
	TargetQueryID string `json:"target_query_id"`
	Polarity      string `json:"polarity"`
	PayloadHash   string `json:"payload_hash"`
}

type authorityRuleEvent struct {
	commonEvent
	SubjectKind string `json:"subject_kind"`
	SubjectID   string `json:"subject_id"`
	Rule        string `json:"rule"`
}

type decodedEvent struct {
	Raw    []byte
	Common commonEvent
	Value  any
}

type validationState struct {
	LedgerSHA      string
	Events         []decodedEvent
	Schemas        map[string]schemaEvent
	Fields         map[string]fieldEvent
	Deprecations   map[string]fieldDeprecatedEvent
	Edges          []edgeEvent
	Queries        map[string]queryEvent
	Fixtures       map[string]fixtureEvent
	AuthorityRules []authorityRuleEvent
	Impact         []deprecationImpact
}

type deprecationImpact struct {
	FieldRef                string   `json:"fieldRef"`
	ReplacementFieldRef     string   `json:"replacementFieldRef,omitempty"`
	AffectedQueries         []string `json:"affectedQueries"`
	AffectedFixtures        []string `json:"affectedFixtures"`
	UnresolvedQueryFamilies []string `json:"unresolvedQueryFamilies"`
}

type validationReport struct {
	Schema           string              `json:"schema"`
	Status           string              `json:"status"`
	Validator        string              `json:"validator"`
	LedgerSHA256     string              `json:"ledgerSha256"`
	Rows             int                 `json:"rows"`
	Schemas          int                 `json:"schemas"`
	Fields           int                 `json:"fields"`
	Edges            int                 `json:"edges"`
	Queries          int                 `json:"queries"`
	Fixtures         int                 `json:"fixtures"`
	AuthorityRules   int                 `json:"authorityRules"`
	Deprecations     int                 `json:"deprecations"`
	UnresolvedImpact []deprecationImpact `json:"unresolvedImpact,omitempty"`
}

type schemaCatalog struct {
	Schema       string               `json:"schema"`
	LedgerSHA256 string               `json:"ledgerSha256"`
	Schemas      []catalogSchema      `json:"schemas"`
	Edges        []edgeEvent          `json:"edges"`
	Queries      []queryEvent         `json:"queries"`
	Fixtures     []fixtureEvent       `json:"fixtures"`
	Authority    []authorityRuleEvent `json:"authorityRules"`
}

type catalogSchema struct {
	ID        string         `json:"id"`
	Title     string         `json:"title"`
	Lifecycle string         `json:"lifecycle"`
	Fields    []catalogField `json:"fields"`
}

type catalogField struct {
	ID          string   `json:"id"`
	Type        string   `json:"type"`
	Required    bool     `json:"required"`
	PII         bool     `json:"pii"`
	Description string   `json:"description"`
	EnumValues  []string `json:"enumValues,omitempty"`
	RefSchema   string   `json:"refSchema,omitempty"`
	Deprecated  bool     `json:"deprecated"`
	Replacement string   `json:"replacement,omitempty"`
}

type contractIndex struct {
	Schema                  string              `json:"schema"`
	LedgerSHA256            string              `json:"ledgerSha256"`
	EventCount              int                 `json:"eventCount"`
	SchemaToFields          map[string][]string `json:"schemaToFields"`
	FieldToQueries          map[string][]string `json:"fieldToQueries"`
	QueryToFixtures         map[string][]string `json:"queryToFixtures"`
	DeprecationImpact       []deprecationImpact `json:"deprecationImpact"`
	UnresolvedQueryFamilies []string            `json:"unresolvedQueryFamilies"`
}

type projectionManifest struct {
	Generator      string            `json:"generator"`
	Validator      string            `json:"validator"`
	CueRuntime     bool              `json:"cueRuntimeRequired"`
	ContractLedger string            `json:"contractLedger"`
	MetaContract   string            `json:"metaContract"`
	ContractSHA256 string            `json:"contractSha256"`
	MetaSHA256     string            `json:"metaSha256"`
	ArtifactHashes map[string]string `json:"artifactHashes"`
	Scope          string            `json:"scope"`
}

type rawHeader struct {
	EventID string `json:"event_id"`
	Kind    string `json:"kind"`
}

type jsonObject map[string]json.RawMessage
