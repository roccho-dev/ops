package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

func writeProjection(out string, ledger, meta []byte, state *validationState) error {
	if err := os.RemoveAll(out); err != nil {
		return err
	}
	if err := os.MkdirAll(out, 0o755); err != nil {
		return err
	}
	artifacts := map[string][]byte{}
	artifacts["events.jsonl"] = append([]byte(nil), ledger...)
	artifacts["meta.cue"] = append([]byte(nil), meta...)

	reportBytes, err := marshalJSON(makeReport(state))
	if err != nil {
		return err
	}
	artifacts["validation-report.json"] = reportBytes
	catalogBytes, err := marshalJSON(buildCatalog(state))
	if err != nil {
		return err
	}
	artifacts["jsonschema/schema-catalog.json"] = catalogBytes
	indexBytes, err := marshalJSON(buildIndex(state))
	if err != nil {
		return err
	}
	artifacts["indexes/contract-index.json"] = indexBytes
	schemaBytes, err := marshalJSON(buildJSONSchema())
	if err != nil {
		return err
	}
	artifacts["jsonschema/contract-event.schema.json"] = schemaBytes

	paths := make([]string, 0, len(artifacts))
	for path := range artifacts {
		paths = append(paths, path)
	}
	sort.Strings(paths)
	hashes := map[string]string{}
	for _, rel := range paths {
		data := artifacts[rel]
		if err := writeFile(filepath.Join(out, filepath.FromSlash(rel)), data); err != nil {
			return err
		}
		hashes[rel] = "sha256:" + shaBytes(data)
	}
	manifest := projectionManifest{
		Generator: validatorVersion, Validator: "go-fast-v1", CueRuntime: false,
		ContractLedger: "events.jsonl", MetaContract: "meta.cue",
		ContractSHA256: "sha256:" + shaBytes(ledger), MetaSHA256: "sha256:" + shaBytes(meta),
		ArtifactHashes: hashes, Scope: "contracts/contract-schema",
	}
	manifestBytes, err := marshalJSON(manifest)
	if err != nil {
		return err
	}
	return writeFile(filepath.Join(out, "manifest.json"), manifestBytes)
}

func writeFile(path string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}

func buildCatalog(state *validationState) schemaCatalog {
	schemaIDs := make([]string, 0, len(state.Schemas))
	for id := range state.Schemas {
		schemaIDs = append(schemaIDs, id)
	}
	sort.Strings(schemaIDs)
	catalogSchemas := make([]catalogSchema, 0, len(schemaIDs))
	for _, id := range schemaIDs {
		schemaEvent := state.Schemas[id]
		fieldRefs := make([]string, 0)
		for ref, field := range state.Fields {
			if field.SchemaID == id {
				fieldRefs = append(fieldRefs, ref)
			}
		}
		sort.Strings(fieldRefs)
		fields := make([]catalogField, 0, len(fieldRefs))
		for _, ref := range fieldRefs {
			field := state.Fields[ref]
			deprecation, deprecated := state.Deprecations[ref]
			fields = append(fields, catalogField{
				ID: field.FieldID, Type: field.FieldType, Required: field.Required, PII: field.PII,
				Description: field.Description, EnumValues: append([]string(nil), field.EnumValues...), RefSchema: field.RefSchema,
				Deprecated: deprecated, Replacement: deprecation.ReplacementFieldRef,
			})
		}
		catalogSchemas = append(catalogSchemas, catalogSchema{ID: id, Title: schemaEvent.Title, Lifecycle: schemaEvent.Lifecycle, Fields: fields})
	}

	edges := append([]edgeEvent(nil), state.Edges...)
	sort.Slice(edges, func(i, j int) bool {
		if edges[i].FromSchema != edges[j].FromSchema {
			return edges[i].FromSchema < edges[j].FromSchema
		}
		if edges[i].ToSchema != edges[j].ToSchema {
			return edges[i].ToSchema < edges[j].ToSchema
		}
		return edges[i].EventID < edges[j].EventID
	})
	queryIDs := sortedQueryIDs(state.Queries)
	queries := make([]queryEvent, 0, len(queryIDs))
	for _, id := range queryIDs {
		query := state.Queries[id]
		query.InputFields = append([]string(nil), query.InputFields...)
		query.FixtureIDs = append([]string(nil), query.FixtureIDs...)
		queries = append(queries, query)
	}
	fixtureIDs := make([]string, 0, len(state.Fixtures))
	for id := range state.Fixtures {
		fixtureIDs = append(fixtureIDs, id)
	}
	sort.Strings(fixtureIDs)
	fixtures := make([]fixtureEvent, 0, len(fixtureIDs))
	for _, id := range fixtureIDs {
		fixtures = append(fixtures, state.Fixtures[id])
	}
	authority := append([]authorityRuleEvent(nil), state.AuthorityRules...)
	sort.Slice(authority, func(i, j int) bool {
		if authority[i].SubjectKind != authority[j].SubjectKind {
			return authority[i].SubjectKind < authority[j].SubjectKind
		}
		if authority[i].SubjectID != authority[j].SubjectID {
			return authority[i].SubjectID < authority[j].SubjectID
		}
		return authority[i].Rule < authority[j].Rule
	})
	return schemaCatalog{Schema: "contract-schema-catalog/1", LedgerSHA256: "sha256:" + state.LedgerSHA, Schemas: catalogSchemas, Edges: edges, Queries: queries, Fixtures: fixtures, Authority: authority}
}

func buildIndex(state *validationState) contractIndex {
	schemaToFields := map[string][]string{}
	for ref, field := range state.Fields {
		schemaToFields[field.SchemaID] = append(schemaToFields[field.SchemaID], ref)
	}
	for id := range state.Schemas {
		if _, ok := schemaToFields[id]; !ok {
			schemaToFields[id] = []string{}
		}
	}
	for id := range schemaToFields {
		sort.Strings(schemaToFields[id])
	}
	fieldToQueries := map[string][]string{}
	for ref := range state.Fields {
		fieldToQueries[ref] = []string{}
	}
	for id, query := range state.Queries {
		for _, ref := range query.InputFields {
			fieldToQueries[ref] = append(fieldToQueries[ref], id)
		}
	}
	for ref := range fieldToQueries {
		sort.Strings(fieldToQueries[ref])
	}
	queryToFixtures := map[string][]string{}
	for id, query := range state.Queries {
		values := append([]string(nil), query.FixtureIDs...)
		sort.Strings(values)
		queryToFixtures[id] = values
	}
	unresolvedSet := map[string]struct{}{}
	for _, impact := range state.Impact {
		for _, family := range impact.UnresolvedQueryFamilies {
			unresolvedSet[family] = struct{}{}
		}
	}
	return contractIndex{
		Schema: "contract-index/1", LedgerSHA256: "sha256:" + state.LedgerSHA, EventCount: len(state.Events),
		SchemaToFields: schemaToFields, FieldToQueries: fieldToQueries, QueryToFixtures: queryToFixtures,
		DeprecationImpact: append([]deprecationImpact(nil), state.Impact...), UnresolvedQueryFamilies: sortedSet(unresolvedSet),
	}
}

func buildJSONSchema() map[string]any {
	common := map[string]any{
		"event_id":       map[string]any{"type": "string", "pattern": eventIDPattern.String()},
		"schema_version": map[string]any{"const": metaVersion},
		"created_at":     map[string]any{"type": "string", "pattern": `^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$`},
		"purpose_level":  map[string]any{"type": "string", "pattern": purposePattern.String()},
		"authority":      map[string]any{"enum": sortedKeys(validRoles)},
	}
	propertiesByKind := map[string]map[string]any{
		"contract.schema.v1": {
			"schema_id": map[string]any{"type": "string", "pattern": schemaIDPattern.String()},
			"title":     map[string]any{"type": "string", "minLength": 1},
			"lifecycle": map[string]any{"enum": []string{"active", "deprecated"}},
		},
		"contract.field.v1": {
			"schema_id":   map[string]any{"type": "string", "pattern": schemaIDPattern.String()},
			"field_id":    map[string]any{"type": "string", "pattern": fieldIDPattern.String()},
			"field_type":  map[string]any{"enum": sortedKeys(validFieldTypes)},
			"required":    map[string]any{"type": "boolean"},
			"pii":         map[string]any{"type": "boolean"},
			"description": map[string]any{"type": "string", "minLength": 1},
			"enum_values": map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "minItems": 1, "uniqueItems": true},
			"ref_schema":  map[string]any{"type": "string", "pattern": schemaIDPattern.String()},
		},
		"contract.field.deprecated.v1": {
			"schema_id":             map[string]any{"type": "string", "pattern": schemaIDPattern.String()},
			"field_id":              map[string]any{"type": "string", "pattern": fieldIDPattern.String()},
			"reason":                map[string]any{"type": "string", "minLength": 1},
			"replacement_field_ref": map[string]any{"type": "string", "pattern": fieldRefPattern.String()},
		},
		"contract.edge.v1": {
			"edge_kind":        map[string]any{"type": "string", "pattern": edgeKindPattern.String()},
			"from_schema":      map[string]any{"type": "string", "pattern": schemaIDPattern.String()},
			"to_schema":        map[string]any{"type": "string", "pattern": schemaIDPattern.String()},
			"cardinality":      map[string]any{"enum": sortedKeys(validCardinalities)},
			"acyclic_required": map[string]any{"type": "boolean"},
		},
		"contract.query.v1": {
			"query_id":             map[string]any{"type": "string", "pattern": queryIDPattern.String()},
			"query_family":         map[string]any{"type": "string", "pattern": queryFamilyPattern.String()},
			"input_fields":         map[string]any{"type": "array", "items": map[string]any{"type": "string", "pattern": fieldRefPattern.String()}, "minItems": 1, "uniqueItems": true},
			"output_schema":        map[string]any{"type": "string", "pattern": schemaIDPattern.String()},
			"runner_kind":          map[string]any{"enum": sortedKeys(validRunners)},
			"projection_only":      map[string]any{"const": true},
			"side_effects":         map[string]any{"const": false},
			"fixture_ids":          map[string]any{"type": "array", "items": map[string]any{"type": "string", "pattern": fixtureIDPattern.String()}, "minItems": 1, "uniqueItems": true},
			"expected_output_hash": map[string]any{"type": "string", "pattern": hashPattern.String()},
		},
		"contract.fixture.v1": {
			"fixture_id":      map[string]any{"type": "string", "pattern": fixtureIDPattern.String()},
			"target_query_id": map[string]any{"type": "string", "pattern": queryIDPattern.String()},
			"polarity":        map[string]any{"enum": []string{"positive", "negative"}},
			"payload_hash":    map[string]any{"type": "string", "pattern": hashPattern.String()},
		},
		"contract.authority_rule.v1": {
			"subject_kind": map[string]any{"enum": []string{"schema", "query", "projection", "decision"}},
			"subject_id":   map[string]any{"type": "string", "minLength": 1},
			"rule":         map[string]any{"enum": sortedKeys(validAuthorityRules)},
		},
	}
	oneOf := make([]any, 0, len(propertiesByKind))
	for _, kind := range sortedRequiredKinds() {
		properties := map[string]any{}
		for key, value := range common {
			properties[key] = value
		}
		properties["kind"] = map[string]any{"const": kind}
		for key, value := range propertiesByKind[kind] {
			properties[key] = value
		}
		branch := map[string]any{
			"type": "object", "additionalProperties": false,
			"required":   append([]string(nil), requiredFields[kind]...),
			"properties": properties,
		}
		if kind == "contract.field.v1" {
			branch["allOf"] = []any{
				map[string]any{
					"if":   map[string]any{"properties": map[string]any{"field_type": map[string]any{"const": "enum"}}},
					"then": map[string]any{"required": []string{"enum_values"}},
				},
				map[string]any{
					"if":   map[string]any{"properties": map[string]any{"field_type": map[string]any{"enum": []string{"ref", "array<ref>"}}}},
					"then": map[string]any{"required": []string{"ref_schema"}},
				},
			}
		}
		oneOf = append(oneOf, branch)
	}
	return map[string]any{
		"$schema":     "https://json-schema.org/draft/2020-12/schema",
		"$id":         "urn:contract-event.schema.json",
		"title":       "Append-only contract event",
		"oneOf":       oneOf,
		"x-validator": validatorVersion,
		"x-note":      "Go validator additionally checks append-only prefix identity, cross-row references, graph cycles, and deprecation impact.",
	}
}

func sortedRequiredKinds() []string {
	kinds := make([]string, 0, len(requiredFields))
	for kind := range requiredFields {
		kinds = append(kinds, kind)
	}
	sort.Strings(kinds)
	return kinds
}

func sortedKeys(values map[string]struct{}) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func verifyProjectionManifest(out string) error {
	data, err := os.ReadFile(filepath.Join(out, "manifest.json"))
	if err != nil {
		return err
	}
	var manifest projectionManifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return err
	}
	for rel, expected := range manifest.ArtifactHashes {
		payload, err := os.ReadFile(filepath.Join(out, filepath.FromSlash(rel)))
		if err != nil {
			return err
		}
		if actual := "sha256:" + shaBytes(payload); actual != expected {
			return fmt.Errorf("artifact hash mismatch %s: %s != %s", rel, actual, expected)
		}
	}
	return nil
}

func normalizedProjectionDigest(out string) (string, error) {
	manifest, err := os.ReadFile(filepath.Join(out, "manifest.json"))
	if err != nil {
		return "", err
	}
	return shaBytes([]byte(strings.TrimSpace(string(manifest)))), nil
}
