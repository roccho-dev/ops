package validate

import (
	"regexp"
	"strings"
)

var (
	reEventID     = regexp.MustCompile(`^evt_[a-z0-9][a-z0-9_]{6,}$`)
	reSchemaID    = regexp.MustCompile(`^[a-z][a-z0-9_]*\.v[0-9]+$`)
	reFieldID     = regexp.MustCompile(`^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$`)
	reQueryID     = regexp.MustCompile(`^q_[a-z0-9_]+\.v[0-9]+$`)
	reQueryFamily = regexp.MustCompile(`^[a-z][a-z0-9_]*$`)
	reFixtureID   = regexp.MustCompile(`^fx_[a-z0-9_]+$`)
	reHash        = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)
	reTime        = regexp.MustCompile(`^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$`)
	rePurpose     = regexp.MustCompile(`^(purpose|meta\^[0-9]+)$`)
	reFieldRef    = regexp.MustCompile(`^[a-z][a-z0-9_]*\.v[0-9]+#[a-z][a-z0-9_.]*$`)
)

func FastValidate(ev Event) []string {
	errs := []string{}
	kind := Str(ev["kind"])
	allowed := map[string]bool{}
	addCommon := func() {
		for _, k := range []string{"event_id", "schema_version", "created_at", "purpose_level", "authority", "kind"} {
			allowed[k] = true
		}
		if !reEventID.MatchString(Str(ev["event_id"])) {
			errs = append(errs, "bad event_id")
		}
		if Str(ev["schema_version"]) != "contract.meta.v1" {
			errs = append(errs, "bad schema_version")
		}
		if !reTime.MatchString(Str(ev["created_at"])) {
			errs = append(errs, "bad created_at")
		}
		if !rePurpose.MatchString(Str(ev["purpose_level"])) {
			errs = append(errs, "bad purpose_level")
		}
		if !In(Str(ev["authority"]), []string{"contract_owner", "governance", "extractor", "projection_runner", "agent", "human"}) {
			errs = append(errs, "bad authority")
		}
	}
	add := func(keys ...string) {
		for _, k := range keys {
			allowed[k] = true
		}
	}
	addCommon()
	switch kind {
	case "contract.schema.v1":
		add("schema_id", "title", "lifecycle")
		if !reSchemaID.MatchString(Str(ev["schema_id"])) {
			errs = append(errs, "bad schema_id")
		}
		if !In(Str(ev["lifecycle"]), []string{"active", "deprecated"}) {
			errs = append(errs, "bad lifecycle")
		}
		if _, ok := ev["title"].(string); !ok {
			errs = append(errs, "title must be string")
		}
	case "contract.field.v1":
		add("schema_id", "field_id", "field_type", "required", "pii", "description", "enum_values", "ref_schema")
		if !reSchemaID.MatchString(Str(ev["schema_id"])) {
			errs = append(errs, "bad schema_id")
		}
		if !reFieldID.MatchString(Str(ev["field_id"])) {
			errs = append(errs, "bad field_id")
		}
		if !In(Str(ev["field_type"]), []string{"string", "number", "integer", "boolean", "timestamp", "hash", "id", "enum", "ref", "array<string>", "array<ref>"}) {
			errs = append(errs, "bad field_type")
		}
		if _, ok := ev["required"].(bool); !ok {
			errs = append(errs, "required must be bool")
		}
		if _, ok := ev["pii"].(bool); !ok {
			errs = append(errs, "pii must be bool")
		}
		if _, ok := ev["description"].(string); !ok {
			errs = append(errs, "description must be string")
		}
	case "contract.field.deprecated.v1":
		add("schema_id", "field_id", "reason", "replacement_field_ref")
		if !reSchemaID.MatchString(Str(ev["schema_id"])) {
			errs = append(errs, "bad schema_id")
		}
		if !reFieldID.MatchString(Str(ev["field_id"])) {
			errs = append(errs, "bad field_id")
		}
		if _, ok := ev["reason"].(string); !ok {
			errs = append(errs, "reason must be string")
		}
		if v, ok := ev["replacement_field_ref"]; ok && !reFieldRef.MatchString(Str(v)) {
			errs = append(errs, "bad replacement_field_ref")
		}
	case "contract.edge.v1":
		add("edge_kind", "from_schema", "to_schema", "cardinality", "acyclic_required")
		if !reQueryFamily.MatchString(Str(ev["edge_kind"])) {
			errs = append(errs, "bad edge_kind")
		}
		if !reSchemaID.MatchString(Str(ev["from_schema"])) {
			errs = append(errs, "bad from_schema")
		}
		if !reSchemaID.MatchString(Str(ev["to_schema"])) {
			errs = append(errs, "bad to_schema")
		}
		if !In(Str(ev["cardinality"]), []string{"one_to_one", "one_to_many", "many_to_one", "many_to_many"}) {
			errs = append(errs, "bad cardinality")
		}
		if _, ok := ev["acyclic_required"].(bool); !ok {
			errs = append(errs, "acyclic_required must be bool")
		}
	case "contract.query.v1":
		add("query_id", "query_family", "input_fields", "output_schema", "runner_kind", "projection_only", "side_effects", "fixture_ids", "expected_output_hash")
		if !reQueryID.MatchString(Str(ev["query_id"])) {
			errs = append(errs, "bad query_id")
		}
		if !reQueryFamily.MatchString(Str(ev["query_family"])) {
			errs = append(errs, "bad query_family")
		}
		for _, r := range ToStrings(ev["input_fields"]) {
			if !reFieldRef.MatchString(r) {
				errs = append(errs, "bad input_field")
			}
		}
		if !reSchemaID.MatchString(Str(ev["output_schema"])) {
			errs = append(errs, "bad output_schema")
		}
		if !In(Str(ev["runner_kind"]), []string{"generated", "duckdb", "go", "ts", "python", "jq"}) {
			errs = append(errs, "bad runner_kind")
		}
		if v, ok := ev["projection_only"].(bool); !ok || !v {
			errs = append(errs, "projection_only must be true")
		}
		if v, ok := ev["side_effects"].(bool); !ok || v {
			errs = append(errs, "side_effects must be false")
		}
		for _, fx := range ToStrings(ev["fixture_ids"]) {
			if !reFixtureID.MatchString(fx) {
				errs = append(errs, "bad fixture_id in query")
			}
		}
		if !reHash.MatchString(Str(ev["expected_output_hash"])) {
			errs = append(errs, "bad expected_output_hash")
		}
	case "contract.fixture.v1":
		add("fixture_id", "target_query_id", "polarity", "payload_hash")
		if !reFixtureID.MatchString(Str(ev["fixture_id"])) {
			errs = append(errs, "bad fixture_id")
		}
		if !reQueryID.MatchString(Str(ev["target_query_id"])) {
			errs = append(errs, "bad target_query_id")
		}
		if !In(Str(ev["polarity"]), []string{"positive", "negative"}) {
			errs = append(errs, "bad polarity")
		}
		if !reHash.MatchString(Str(ev["payload_hash"])) {
			errs = append(errs, "bad payload_hash")
		}
	case "contract.authority_rule.v1":
		add("subject_kind", "subject_id", "rule")
		if !In(Str(ev["subject_kind"]), []string{"schema", "query", "projection", "decision"}) {
			errs = append(errs, "bad subject_kind")
		}
		if _, ok := ev["subject_id"].(string); !ok {
			errs = append(errs, "subject_id must be string")
		}
		if !In(Str(ev["rule"]), []string{"projection_cannot_decide", "decision_requires_owner", "receipt_required", "raw_cannot_decide"}) {
			errs = append(errs, "bad rule")
		}
	default:
		errs = append(errs, "unknown kind")
	}
	for k := range ev {
		if strings.HasPrefix(k, "__") {
			continue
		}
		if !allowed[k] {
			errs = append(errs, "unknown field "+k)
		}
	}
	return errs
}
