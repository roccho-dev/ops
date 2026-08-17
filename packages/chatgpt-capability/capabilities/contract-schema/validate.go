package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

var (
	eventIDPattern     = regexp.MustCompile(`^evt_[a-z0-9][a-z0-9_]{6,}$`)
	schemaIDPattern    = regexp.MustCompile(`^[a-z][a-z0-9_]*\.v[0-9]+$`)
	fieldIDPattern     = regexp.MustCompile(`^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$`)
	queryIDPattern     = regexp.MustCompile(`^q_[a-z0-9_]+\.v[0-9]+$`)
	queryFamilyPattern = regexp.MustCompile(`^[a-z][a-z0-9_]*$`)
	fixtureIDPattern   = regexp.MustCompile(`^fx_[a-z0-9_]+$`)
	edgeKindPattern    = regexp.MustCompile(`^[a-z][a-z0-9_]*$`)
	hashPattern        = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)
	fieldRefPattern    = regexp.MustCompile(`^[a-z][a-z0-9_]*\.v[0-9]+#[a-z][a-z0-9_.]*$`)
	purposePattern     = regexp.MustCompile(`^(purpose|meta\^[0-9]+)$`)
)

var validRoles = setOf("contract_owner", "governance", "extractor", "projection_runner", "agent", "human")
var validFieldTypes = setOf("string", "number", "integer", "boolean", "timestamp", "hash", "id", "enum", "ref", "array<string>", "array<ref>")
var validCardinalities = setOf("one_to_one", "one_to_many", "many_to_one", "many_to_many")
var validRunners = setOf("generated", "duckdb", "go", "ts", "python", "jq")
var validAuthorityRules = setOf("projection_cannot_decide", "decision_requires_owner", "receipt_required", "raw_cannot_decide")

func setOf(values ...string) map[string]struct{} {
	result := make(map[string]struct{}, len(values))
	for _, value := range values {
		result[value] = struct{}{}
	}
	return result
}

func validateLedger(candidate, previous []byte) (*validationState, error) {
	candidateLines, err := splitLedger(candidate)
	if err != nil {
		return nil, err
	}
	if len(previous) > 0 {
		previousLines, err := splitLedger(previous)
		if err != nil {
			return nil, fmt.Errorf("previous ledger: %w", err)
		}
		if len(candidateLines) < len(previousLines) {
			return nil, fmt.Errorf("append-only violation: candidate has %d rows, previous has %d", len(candidateLines), len(previousLines))
		}
		for i := range previousLines {
			if !bytes.Equal(candidateLines[i], previousLines[i]) {
				return nil, fmt.Errorf("append-only violation: row %d was rewritten", i+1)
			}
		}
	}

	state := &validationState{
		LedgerSHA:    shaBytes(candidate),
		Schemas:      map[string]schemaEvent{},
		Fields:       map[string]fieldEvent{},
		Deprecations: map[string]fieldDeprecatedEvent{},
		Queries:      map[string]queryEvent{},
		Fixtures:     map[string]fixtureEvent{},
	}
	seenEventIDs := map[string]int{}
	for i, line := range candidateLines {
		event, err := decodeEvent(line)
		if err != nil {
			return nil, fmt.Errorf("row %d: %w", i+1, err)
		}
		if first, exists := seenEventIDs[event.Common.EventID]; exists {
			return nil, fmt.Errorf("row %d: duplicate event_id %q; first seen at row %d", i+1, event.Common.EventID, first)
		}
		seenEventIDs[event.Common.EventID] = i + 1
		state.Events = append(state.Events, event)
		switch value := event.Value.(type) {
		case schemaEvent:
			if _, exists := state.Schemas[value.SchemaID]; exists {
				return nil, fmt.Errorf("row %d: duplicate schema_id %q", i+1, value.SchemaID)
			}
			state.Schemas[value.SchemaID] = value
		case fieldEvent:
			ref := fieldRef(value.SchemaID, value.FieldID)
			if _, exists := state.Fields[ref]; exists {
				return nil, fmt.Errorf("row %d: duplicate field %q", i+1, ref)
			}
			state.Fields[ref] = value
		case fieldDeprecatedEvent:
			ref := fieldRef(value.SchemaID, value.FieldID)
			if _, exists := state.Deprecations[ref]; exists {
				return nil, fmt.Errorf("row %d: duplicate deprecation %q", i+1, ref)
			}
			state.Deprecations[ref] = value
		case edgeEvent:
			state.Edges = append(state.Edges, value)
		case queryEvent:
			if _, exists := state.Queries[value.QueryID]; exists {
				return nil, fmt.Errorf("row %d: duplicate query_id %q", i+1, value.QueryID)
			}
			state.Queries[value.QueryID] = value
		case fixtureEvent:
			if _, exists := state.Fixtures[value.FixtureID]; exists {
				return nil, fmt.Errorf("row %d: duplicate fixture_id %q", i+1, value.FixtureID)
			}
			state.Fixtures[value.FixtureID] = value
		case authorityRuleEvent:
			state.AuthorityRules = append(state.AuthorityRules, value)
		default:
			return nil, fmt.Errorf("row %d: internal unsupported event type", i+1)
		}
	}
	if err := validateSemanticReferences(state); err != nil {
		return nil, err
	}
	state.Impact = buildDeprecationImpact(state)
	return state, nil
}

func splitLedger(data []byte) ([][]byte, error) {
	if len(data) == 0 {
		return nil, fmt.Errorf("ledger is empty")
	}
	if !bytes.HasSuffix(data, []byte{'\n'}) {
		return nil, fmt.Errorf("ledger must end with newline")
	}
	if bytes.Contains(data, []byte{'\r'}) {
		return nil, fmt.Errorf("ledger must use LF newlines")
	}
	raw := bytes.Split(data[:len(data)-1], []byte{'\n'})
	lines := make([][]byte, 0, len(raw))
	for i, line := range raw {
		if len(line) == 0 {
			return nil, fmt.Errorf("row %d is blank", i+1)
		}
		if len(line) > 4*1024*1024 {
			return nil, fmt.Errorf("row %d exceeds 4MiB", i+1)
		}
		copyLine := append([]byte(nil), line...)
		lines = append(lines, copyLine)
	}
	return lines, nil
}

func decodeEvent(line []byte) (decodedEvent, error) {
	if err := rejectDuplicateJSONKeys(line); err != nil {
		return decodedEvent{}, err
	}
	var object jsonObject
	if err := json.Unmarshal(line, &object); err != nil {
		return decodedEvent{}, fmt.Errorf("invalid JSON: %w", err)
	}
	var header rawHeader
	if err := json.Unmarshal(line, &header); err != nil {
		return decodedEvent{}, err
	}
	if header.Kind == "" {
		return decodedEvent{}, fmt.Errorf("kind is required")
	}
	required, ok := requiredFields[header.Kind]
	if !ok {
		return decodedEvent{}, fmt.Errorf("unsupported kind %q", header.Kind)
	}
	for _, field := range required {
		if _, exists := object[field]; !exists {
			return decodedEvent{}, fmt.Errorf("%s is required for %s", field, header.Kind)
		}
	}
	var value any
	switch header.Kind {
	case "contract.schema.v1":
		value = &schemaEvent{}
	case "contract.field.v1":
		value = &fieldEvent{}
	case "contract.field.deprecated.v1":
		value = &fieldDeprecatedEvent{}
	case "contract.edge.v1":
		value = &edgeEvent{}
	case "contract.query.v1":
		value = &queryEvent{}
	case "contract.fixture.v1":
		value = &fixtureEvent{}
	case "contract.authority_rule.v1":
		value = &authorityRuleEvent{}
	}
	if err := decodeStrict(line, value); err != nil {
		return decodedEvent{}, err
	}
	var common commonEvent
	if err := json.Unmarshal(line, &common); err != nil {
		return decodedEvent{}, err
	}
	if err := validateCommon(common); err != nil {
		return decodedEvent{}, err
	}
	if err := validateShape(value); err != nil {
		return decodedEvent{}, err
	}
	return decodedEvent{Raw: append([]byte(nil), line...), Common: common, Value: dereference(value)}, nil
}

func rejectDuplicateJSONKeys(data []byte) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	var walk func() error
	walk = func() error {
		token, err := decoder.Token()
		if err != nil {
			return err
		}
		delim, ok := token.(json.Delim)
		if !ok {
			return nil
		}
		switch delim {
		case '{':
			seen := map[string]struct{}{}
			for decoder.More() {
				keyToken, err := decoder.Token()
				if err != nil {
					return err
				}
				key, ok := keyToken.(string)
				if !ok {
					return fmt.Errorf("object key is not a string")
				}
				if _, duplicate := seen[key]; duplicate {
					return fmt.Errorf("duplicate JSON key %q", key)
				}
				seen[key] = struct{}{}
				if err := walk(); err != nil {
					return err
				}
			}
			closing, err := decoder.Token()
			if err != nil {
				return err
			}
			if closing != json.Delim('}') {
				return fmt.Errorf("invalid object close token")
			}
		case '[':
			for decoder.More() {
				if err := walk(); err != nil {
					return err
				}
			}
			closing, err := decoder.Token()
			if err != nil {
				return err
			}
			if closing != json.Delim(']') {
				return fmt.Errorf("invalid array close token")
			}
		default:
			return fmt.Errorf("unexpected JSON delimiter %q", delim)
		}
		return nil
	}
	if err := walk(); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		if err == nil {
			return fmt.Errorf("trailing JSON value")
		}
		return fmt.Errorf("trailing JSON data: %w", err)
	}
	return nil
}

func decodeStrict(line []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(line))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		if err == nil {
			return fmt.Errorf("trailing JSON value")
		}
		return fmt.Errorf("trailing JSON data: %w", err)
	}
	return nil
}

func dereference(value any) any {
	switch v := value.(type) {
	case *schemaEvent:
		return *v
	case *fieldEvent:
		return *v
	case *fieldDeprecatedEvent:
		return *v
	case *edgeEvent:
		return *v
	case *queryEvent:
		return *v
	case *fixtureEvent:
		return *v
	case *authorityRuleEvent:
		return *v
	default:
		return value
	}
}

func validateCommon(event commonEvent) error {
	if !eventIDPattern.MatchString(event.EventID) {
		return fmt.Errorf("invalid event_id %q", event.EventID)
	}
	if event.SchemaVersion != metaVersion {
		return fmt.Errorf("unsupported schema_version %q", event.SchemaVersion)
	}
	if _, err := time.Parse("2006-01-02T15:04:05Z", event.CreatedAt); err != nil {
		return fmt.Errorf("invalid created_at %q", event.CreatedAt)
	}
	if !purposePattern.MatchString(event.PurposeLevel) {
		return fmt.Errorf("invalid purpose_level %q", event.PurposeLevel)
	}
	if _, ok := validRoles[event.Authority]; !ok {
		return fmt.Errorf("invalid authority %q", event.Authority)
	}
	return nil
}

func validateShape(value any) error {
	switch event := value.(type) {
	case *schemaEvent:
		if !schemaIDPattern.MatchString(event.SchemaID) || event.Title == "" || (event.Lifecycle != "active" && event.Lifecycle != "deprecated") {
			return fmt.Errorf("invalid schema event")
		}
	case *fieldEvent:
		if !schemaIDPattern.MatchString(event.SchemaID) || !fieldIDPattern.MatchString(event.FieldID) || event.Description == "" {
			return fmt.Errorf("invalid field event")
		}
		if _, ok := validFieldTypes[event.FieldType]; !ok {
			return fmt.Errorf("invalid field_type %q", event.FieldType)
		}
		if event.FieldType == "enum" {
			if len(event.EnumValues) == 0 {
				return fmt.Errorf("enum_values are required for enum field")
			}
		} else if len(event.EnumValues) > 0 {
			return fmt.Errorf("enum_values are allowed only for enum field")
		}
		if event.FieldType == "ref" || event.FieldType == "array<ref>" {
			if !schemaIDPattern.MatchString(event.RefSchema) {
				return fmt.Errorf("ref_schema is required for reference field")
			}
		} else if event.RefSchema != "" {
			return fmt.Errorf("ref_schema is allowed only for reference field")
		}
	case *fieldDeprecatedEvent:
		if !schemaIDPattern.MatchString(event.SchemaID) || !fieldIDPattern.MatchString(event.FieldID) || event.Reason == "" {
			return fmt.Errorf("invalid field deprecation event")
		}
		if event.ReplacementFieldRef != "" && !fieldRefPattern.MatchString(event.ReplacementFieldRef) {
			return fmt.Errorf("invalid replacement_field_ref %q", event.ReplacementFieldRef)
		}
	case *edgeEvent:
		if !edgeKindPattern.MatchString(event.EdgeKind) || !schemaIDPattern.MatchString(event.FromSchema) || !schemaIDPattern.MatchString(event.ToSchema) {
			return fmt.Errorf("invalid edge event")
		}
		if _, ok := validCardinalities[event.Cardinality]; !ok {
			return fmt.Errorf("invalid cardinality %q", event.Cardinality)
		}
	case *queryEvent:
		if !queryIDPattern.MatchString(event.QueryID) || !queryFamilyPattern.MatchString(event.QueryFamily) || !schemaIDPattern.MatchString(event.OutputSchema) {
			return fmt.Errorf("invalid query event")
		}
		if _, ok := validRunners[event.RunnerKind]; !ok {
			return fmt.Errorf("invalid runner_kind %q", event.RunnerKind)
		}
		if !event.ProjectionOnly || event.SideEffects {
			return fmt.Errorf("query must be projection_only=true and side_effects=false")
		}
		if len(event.InputFields) == 0 || len(event.FixtureIDs) == 0 || !hashPattern.MatchString(event.ExpectedOutputHash) {
			return fmt.Errorf("invalid query inputs, fixtures, or expected_output_hash")
		}
		for _, ref := range event.InputFields {
			if !fieldRefPattern.MatchString(ref) {
				return fmt.Errorf("invalid input field ref %q", ref)
			}
		}
		for _, id := range event.FixtureIDs {
			if !fixtureIDPattern.MatchString(id) {
				return fmt.Errorf("invalid fixture id %q", id)
			}
		}
	case *fixtureEvent:
		if !fixtureIDPattern.MatchString(event.FixtureID) || !queryIDPattern.MatchString(event.TargetQueryID) || (event.Polarity != "positive" && event.Polarity != "negative") || !hashPattern.MatchString(event.PayloadHash) {
			return fmt.Errorf("invalid fixture event")
		}
	case *authorityRuleEvent:
		if event.SubjectKind != "schema" && event.SubjectKind != "query" && event.SubjectKind != "projection" && event.SubjectKind != "decision" {
			return fmt.Errorf("invalid authority subject_kind %q", event.SubjectKind)
		}
		if event.SubjectID == "" {
			return fmt.Errorf("authority subject_id is required")
		}
		if _, ok := validAuthorityRules[event.Rule]; !ok {
			return fmt.Errorf("invalid authority rule %q", event.Rule)
		}
	default:
		return fmt.Errorf("unsupported decoded event")
	}
	return nil
}

func validateSemanticReferences(state *validationState) error {
	for ref, field := range state.Fields {
		if _, ok := state.Schemas[field.SchemaID]; !ok {
			return fmt.Errorf("field %q references missing schema %q", ref, field.SchemaID)
		}
		if field.RefSchema != "" {
			if _, ok := state.Schemas[field.RefSchema]; !ok {
				return fmt.Errorf("field %q references missing ref_schema %q", ref, field.RefSchema)
			}
		}
	}
	for ref, deprecation := range state.Deprecations {
		if _, ok := state.Fields[ref]; !ok {
			return fmt.Errorf("deprecation references missing field %q", ref)
		}
		if deprecation.ReplacementFieldRef != "" {
			if _, ok := state.Fields[deprecation.ReplacementFieldRef]; !ok {
				return fmt.Errorf("deprecation %q references missing replacement %q", ref, deprecation.ReplacementFieldRef)
			}
		}
	}
	for _, edge := range state.Edges {
		if _, ok := state.Schemas[edge.FromSchema]; !ok {
			return fmt.Errorf("edge %q references missing from_schema %q", edge.EventID, edge.FromSchema)
		}
		if _, ok := state.Schemas[edge.ToSchema]; !ok {
			return fmt.Errorf("edge %q references missing to_schema %q", edge.EventID, edge.ToSchema)
		}
	}
	if err := validateAcyclicEdges(state.Edges); err != nil {
		return err
	}
	for id, query := range state.Queries {
		if _, ok := state.Schemas[query.OutputSchema]; !ok {
			return fmt.Errorf("query %q references missing output_schema %q", id, query.OutputSchema)
		}
		for _, ref := range query.InputFields {
			if _, ok := state.Fields[ref]; !ok {
				return fmt.Errorf("query %q references missing input field %q", id, ref)
			}
		}
		for _, fixtureID := range query.FixtureIDs {
			fixture, ok := state.Fixtures[fixtureID]
			if !ok {
				return fmt.Errorf("query %q references missing fixture %q", id, fixtureID)
			}
			if fixture.TargetQueryID != id {
				return fmt.Errorf("query %q fixture %q targets %q", id, fixtureID, fixture.TargetQueryID)
			}
		}
	}
	for id, fixture := range state.Fixtures {
		query, ok := state.Queries[fixture.TargetQueryID]
		if !ok {
			return fmt.Errorf("fixture %q references missing query %q", id, fixture.TargetQueryID)
		}
		if !contains(query.FixtureIDs, id) {
			return fmt.Errorf("fixture %q is not declared by query %q", id, fixture.TargetQueryID)
		}
	}
	for _, rule := range state.AuthorityRules {
		switch rule.SubjectKind {
		case "schema":
			if _, ok := state.Schemas[rule.SubjectID]; !ok {
				return fmt.Errorf("authority rule references missing schema %q", rule.SubjectID)
			}
		case "query":
			if _, ok := state.Queries[rule.SubjectID]; !ok {
				return fmt.Errorf("authority rule references missing query %q", rule.SubjectID)
			}
		}
	}
	return nil
}

func validateAcyclicEdges(edges []edgeEvent) error {
	graph := map[string][]string{}
	for _, edge := range edges {
		if edge.AcyclicRequired {
			graph[edge.FromSchema] = append(graph[edge.FromSchema], edge.ToSchema)
		}
	}
	for key := range graph {
		sort.Strings(graph[key])
	}
	state := map[string]int{}
	var visit func(string) error
	visit = func(node string) error {
		switch state[node] {
		case 1:
			return fmt.Errorf("acyclic edge graph contains cycle at %q", node)
		case 2:
			return nil
		}
		state[node] = 1
		for _, next := range graph[node] {
			if err := visit(next); err != nil {
				return err
			}
		}
		state[node] = 2
		return nil
	}
	keys := make([]string, 0, len(graph))
	for key := range graph {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		if err := visit(key); err != nil {
			return err
		}
	}
	return nil
}

func buildDeprecationImpact(state *validationState) []deprecationImpact {
	refs := make([]string, 0, len(state.Deprecations))
	for ref := range state.Deprecations {
		refs = append(refs, ref)
	}
	sort.Strings(refs)
	impacts := make([]deprecationImpact, 0, len(refs))
	for _, ref := range refs {
		deprecation := state.Deprecations[ref]
		queryIDs := sortedQueryIDs(state.Queries)
		affectedQueries := []string{}
		affectedFixtures := map[string]struct{}{}
		affectedFamilies := map[string]struct{}{}
		affectedVersion := map[string]int{}
		for _, queryID := range queryIDs {
			query := state.Queries[queryID]
			if contains(query.InputFields, ref) {
				affectedQueries = append(affectedQueries, queryID)
				affectedFamilies[query.QueryFamily] = struct{}{}
				_, version := querySortKey(query)
				if version > affectedVersion[query.QueryFamily] {
					affectedVersion[query.QueryFamily] = version
				}
				for _, fixtureID := range query.FixtureIDs {
					affectedFixtures[fixtureID] = struct{}{}
				}
			}
		}
		unresolved := []string{}
		families := sortedSet(affectedFamilies)
		for _, family := range families {
			resolved := false
			for _, query := range state.Queries {
				_, version := querySortKey(query)
				if query.QueryFamily == family && version > affectedVersion[family] && !contains(query.InputFields, ref) {
					resolved = true
					break
				}
			}
			if !resolved {
				unresolved = append(unresolved, family)
			}
		}
		impacts = append(impacts, deprecationImpact{
			FieldRef: ref, ReplacementFieldRef: deprecation.ReplacementFieldRef,
			AffectedQueries: affectedQueries, AffectedFixtures: sortedSet(affectedFixtures), UnresolvedQueryFamilies: unresolved,
		})
	}
	return impacts
}

func makeReport(state *validationState) validationReport {
	unresolved := make([]deprecationImpact, 0)
	for _, impact := range state.Impact {
		if len(impact.UnresolvedQueryFamilies) > 0 {
			unresolved = append(unresolved, impact)
		}
	}
	return validationReport{
		Schema: reportSchema, Status: "PASS", Validator: validatorVersion, LedgerSHA256: "sha256:" + state.LedgerSHA,
		Rows: len(state.Events), Schemas: len(state.Schemas), Fields: len(state.Fields), Edges: len(state.Edges), Queries: len(state.Queries), Fixtures: len(state.Fixtures), AuthorityRules: len(state.AuthorityRules), Deprecations: len(state.Deprecations), UnresolvedImpact: unresolved,
	}
}

func fieldRef(schemaID, fieldID string) string { return schemaID + "#" + fieldID }
func shaBytes(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}
func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
func sortedSet(values map[string]struct{}) []string {
	out := make([]string, 0, len(values))
	for value := range values {
		out = append(out, value)
	}
	sort.Strings(out)
	return out
}
func sortedQueryIDs(values map[string]queryEvent) []string {
	out := make([]string, 0, len(values))
	for value := range values {
		out = append(out, value)
	}
	sort.Slice(out, func(i, j int) bool {
		familyI, versionI := querySortKey(values[out[i]])
		familyJ, versionJ := querySortKey(values[out[j]])
		if familyI != familyJ {
			return familyI < familyJ
		}
		if versionI != versionJ {
			return versionI < versionJ
		}
		return out[i] < out[j]
	})
	return out
}
func querySortKey(query queryEvent) (string, int) {
	parts := strings.Split(query.QueryID, ".v")
	version := 0
	if len(parts) == 2 {
		version, _ = strconv.Atoi(parts[1])
	}
	return query.QueryFamily, version
}

var requiredFields = map[string][]string{
	"contract.schema.v1":           {"event_id", "schema_version", "created_at", "purpose_level", "authority", "kind", "schema_id", "title", "lifecycle"},
	"contract.field.v1":            {"event_id", "schema_version", "created_at", "purpose_level", "authority", "kind", "schema_id", "field_id", "field_type", "required", "pii", "description"},
	"contract.field.deprecated.v1": {"event_id", "schema_version", "created_at", "purpose_level", "authority", "kind", "schema_id", "field_id", "reason"},
	"contract.edge.v1":             {"event_id", "schema_version", "created_at", "purpose_level", "authority", "kind", "edge_kind", "from_schema", "to_schema", "cardinality", "acyclic_required"},
	"contract.query.v1":            {"event_id", "schema_version", "created_at", "purpose_level", "authority", "kind", "query_id", "query_family", "input_fields", "output_schema", "runner_kind", "projection_only", "side_effects", "fixture_ids", "expected_output_hash"},
	"contract.fixture.v1":          {"event_id", "schema_version", "created_at", "purpose_level", "authority", "kind", "fixture_id", "target_query_id", "polarity", "payload_hash"},
	"contract.authority_rule.v1":   {"event_id", "schema_version", "created_at", "purpose_level", "authority", "kind", "subject_kind", "subject_id", "rule"},
}
