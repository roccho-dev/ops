package contract

#EventID: =~"^evt_[a-z0-9][a-z0-9_]{6,}$"
#SchemaID: =~"^[a-z][a-z0-9_]*\\.v[0-9]+$"
#FieldID: =~"^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)*$"
#QueryID: =~"^q_[a-z0-9_]+\\.v[0-9]+$"
#QueryFamily: =~"^[a-z][a-z0-9_]*$"
#FixtureID: =~"^fx_[a-z0-9_]+$"
#Role: "contract_owner" | "governance" | "extractor" | "projection_runner" | "agent" | "human"
#FieldType: "string" | "number" | "integer" | "boolean" | "timestamp" | "hash" | "id" | "enum" | "ref" | "array<string>" | "array<ref>"
#EdgeCardinality: "one_to_one" | "one_to_many" | "many_to_one" | "many_to_many"
#RunnerKind: "generated" | "duckdb" | "go" | "ts" | "python" | "jq"
#Hash: =~"^sha256:[0-9a-f]{64}$"
#Time: =~"^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$"
#Purpose: "purpose" | =~"^meta\\^[0-9]+$"

#Common: {
  event_id: #EventID
  schema_version: "contract.meta.v1"
  created_at: #Time
  purpose_level: #Purpose
  authority: #Role
}

#SchemaEvent: close({
  event_id: #EventID
  schema_version: "contract.meta.v1"
  created_at: #Time
  purpose_level: #Purpose
  authority: #Role
  kind: "contract.schema.v1"
  schema_id: #SchemaID
  title: string
  lifecycle: "active" | "deprecated"
})

#FieldEvent: close({
  event_id: #EventID
  schema_version: "contract.meta.v1"
  created_at: #Time
  purpose_level: #Purpose
  authority: #Role
  kind: "contract.field.v1"
  schema_id: #SchemaID
  field_id: #FieldID
  field_type: #FieldType
  required: bool
  pii: bool
  description: string
  enum_values?: [...string]
  ref_schema?: #SchemaID
})

#FieldDeprecatedEvent: close({
  event_id: #EventID
  schema_version: "contract.meta.v1"
  created_at: #Time
  purpose_level: #Purpose
  authority: #Role
  kind: "contract.field.deprecated.v1"
  schema_id: #SchemaID
  field_id: #FieldID
  reason: string
  replacement_field_ref?: =~"^[a-z][a-z0-9_]*\\.v[0-9]+#[a-z][a-z0-9_.]*$"
})

#EdgeEvent: close({
  event_id: #EventID
  schema_version: "contract.meta.v1"
  created_at: #Time
  purpose_level: #Purpose
  authority: #Role
  kind: "contract.edge.v1"
  edge_kind: =~"^[a-z][a-z0-9_]*$"
  from_schema: #SchemaID
  to_schema: #SchemaID
  cardinality: #EdgeCardinality
  acyclic_required: bool
})

#QueryEvent: close({
  event_id: #EventID
  schema_version: "contract.meta.v1"
  created_at: #Time
  purpose_level: #Purpose
  authority: #Role
  kind: "contract.query.v1"
  query_id: #QueryID
  query_family: #QueryFamily
  input_fields: [...=~"^[a-z][a-z0-9_]*\\.v[0-9]+#[a-z][a-z0-9_.]*$"]
  output_schema: #SchemaID
  runner_kind: #RunnerKind
  projection_only: true
  side_effects: false
  fixture_ids: [...#FixtureID]
  expected_output_hash: #Hash
})

#FixtureEvent: close({
  event_id: #EventID
  schema_version: "contract.meta.v1"
  created_at: #Time
  purpose_level: #Purpose
  authority: #Role
  kind: "contract.fixture.v1"
  fixture_id: #FixtureID
  target_query_id: #QueryID
  polarity: "positive" | "negative"
  payload_hash: #Hash
})

#AuthorityRuleEvent: close({
  event_id: #EventID
  schema_version: "contract.meta.v1"
  created_at: #Time
  purpose_level: #Purpose
  authority: #Role
  kind: "contract.authority_rule.v1"
  subject_kind: "schema" | "query" | "projection" | "decision"
  subject_id: string
  rule: "projection_cannot_decide" | "decision_requires_owner" | "receipt_required" | "raw_cannot_decide"
})

#ContractEvent: #SchemaEvent | #FieldEvent | #FieldDeprecatedEvent | #EdgeEvent | #QueryEvent | #FixtureEvent | #AuthorityRuleEvent
