package artifacts

func ContractEventSchema() map[string]any {
	common := map[string]any{
		"event_id":       map[string]any{"type": "string", "pattern": `^evt_[a-z0-9][a-z0-9_]{6,}$`},
		"schema_version": map[string]any{"const": "contract.meta.v1"},
		"created_at":     map[string]any{"type": "string", "pattern": `^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$`},
		"purpose_level":  map[string]any{"type": "string", "pattern": `^(purpose|meta\^[0-9]+)$`},
		"authority":      map[string]any{"enum": []string{"contract_owner", "governance", "extractor", "projection_runner", "agent", "human"}},
	}
	obj := func(kind string, props map[string]any, req []string) map[string]any {
		p := copyMap(common)
		p["kind"] = map[string]any{"const": kind}
		for k, v := range props {
			p[k] = v
		}
		required := append([]string{"event_id", "schema_version", "created_at", "purpose_level", "authority", "kind"}, req...)
		return map[string]any{"type": "object", "additionalProperties": false, "properties": p, "required": required}
	}
	schemaID := map[string]any{"type": "string", "pattern": `^[a-z][a-z0-9_]*\.v[0-9]+$`}
	fieldID := map[string]any{"type": "string", "pattern": `^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$`}
	qid := map[string]any{"type": "string", "pattern": `^q_[a-z0-9_]+\.v[0-9]+$`}
	fxid := map[string]any{"type": "string", "pattern": `^fx_[a-z0-9_]+$`}
	hashS := map[string]any{"type": "string", "pattern": `^sha256:[0-9a-f]{64}$`}
	fieldRef := map[string]any{"type": "string", "pattern": `^[a-z][a-z0-9_]*\.v[0-9]+#[a-z][a-z0-9_.]*$`}
	return map[string]any{"$schema": "https://json-schema.org/draft/2020-12/schema", "$id": "https://example.invalid/contract-event.schema.json", "oneOf": []any{
		obj("contract.schema.v1", map[string]any{"schema_id": schemaID, "title": map[string]any{"type": "string"}, "lifecycle": map[string]any{"enum": []string{"active", "deprecated"}}}, []string{"schema_id", "title", "lifecycle"}),
		obj("contract.field.v1", map[string]any{"schema_id": schemaID, "field_id": fieldID, "field_type": map[string]any{"enum": []string{"string", "number", "integer", "boolean", "timestamp", "hash", "id", "enum", "ref", "array<string>", "array<ref>"}}, "required": map[string]any{"type": "boolean"}, "pii": map[string]any{"type": "boolean"}, "description": map[string]any{"type": "string"}, "enum_values": map[string]any{"type": "array", "items": map[string]any{"type": "string"}}, "ref_schema": schemaID}, []string{"schema_id", "field_id", "field_type", "required", "pii", "description"}),
		obj("contract.field.deprecated.v1", map[string]any{"schema_id": schemaID, "field_id": fieldID, "reason": map[string]any{"type": "string"}, "replacement_field_ref": fieldRef}, []string{"schema_id", "field_id", "reason"}),
		obj("contract.edge.v1", map[string]any{"edge_kind": map[string]any{"type": "string", "pattern": `^[a-z][a-z0-9_]*$`}, "from_schema": schemaID, "to_schema": schemaID, "cardinality": map[string]any{"enum": []string{"one_to_one", "one_to_many", "many_to_one", "many_to_many"}}, "acyclic_required": map[string]any{"type": "boolean"}}, []string{"edge_kind", "from_schema", "to_schema", "cardinality", "acyclic_required"}),
		obj("contract.query.v1", map[string]any{"query_id": qid, "query_family": map[string]any{"type": "string", "pattern": `^[a-z][a-z0-9_]*$`}, "input_fields": map[string]any{"type": "array", "items": fieldRef}, "output_schema": schemaID, "runner_kind": map[string]any{"enum": []string{"generated", "duckdb", "go", "ts", "python", "jq"}}, "projection_only": map[string]any{"const": true}, "side_effects": map[string]any{"const": false}, "fixture_ids": map[string]any{"type": "array", "items": fxid}, "expected_output_hash": hashS}, []string{"query_id", "query_family", "input_fields", "output_schema", "runner_kind", "projection_only", "side_effects", "fixture_ids", "expected_output_hash"}),
		obj("contract.fixture.v1", map[string]any{"fixture_id": fxid, "target_query_id": qid, "polarity": map[string]any{"enum": []string{"positive", "negative"}}, "payload_hash": hashS}, []string{"fixture_id", "target_query_id", "polarity", "payload_hash"}),
		obj("contract.authority_rule.v1", map[string]any{"subject_kind": map[string]any{"enum": []string{"schema", "query", "projection", "decision"}}, "subject_id": map[string]any{"type": "string"}, "rule": map[string]any{"enum": []string{"projection_cannot_decide", "decision_requires_owner", "receipt_required", "raw_cannot_decide"}}}, []string{"subject_kind", "subject_id", "rule"}),
	}}
}

func GenerateSchemaCatalog(idx Index) map[string]any {
	catalog := map[string]any{"schemas": map[string]any{}, "queries": map[string]any{}, "deprecated_fields": sortedKeys(idx.Deprecated)}
	schemas := catalog["schemas"].(map[string]any)
	for _, sid := range sortedBoolKeys(idx.Schemas) {
		props := map[string]any{}
		required := []string{}
		fids := sortedFieldKeys(idx.Fields[sid])
		for _, fid := range fids {
			f := idx.Fields[sid][fid]
			props[fid] = jsonType(f)
			if f.Required {
				required = append(required, fid)
			}
		}
		schemas[sid] = map[string]any{"properties": props, "required": required, "additionalProperties": false}
	}
	queries := catalog["queries"].(map[string]any)
	qids := sortedQueryKeys(idx.Queries)
	for _, qid := range qids {
		q := idx.Queries[qid]
		queries[qid] = map[string]any{"input_fields": q.Inputs, "output_schema": q.Output, "fixture_ids": q.Fixtures}
	}
	return catalog
}

func GenerateContractIndex(idx Index) map[string]any {
	queryInputs := map[string][]string{}
	for _, qid := range sortedQueryKeys(idx.Queries) {
		queryInputs[qid] = idx.Queries[qid].Inputs
	}
	return map[string]any{"schema_count": len(idx.Schemas), "field_count": fieldCount(idx), "query_count": len(idx.Queries), "fixture_count": len(idx.Fixtures), "deprecated_fields": sortedKeys(idx.Deprecated), "query_inputs": queryInputs}
}
