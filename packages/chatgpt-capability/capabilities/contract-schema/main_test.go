package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestValidLedgerAndProjection(t *testing.T) {
	valid := mustEmbedded(t, "fixtures/valid.contract.jsonl")
	state, err := validateLedger(valid, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(state.Schemas) != 2 || len(state.Queries) != 2 || len(state.Deprecations) != 1 {
		t.Fatalf("unexpected state counts: schemas=%d queries=%d deprecations=%d", len(state.Schemas), len(state.Queries), len(state.Deprecations))
	}
	if len(state.Impact) != 1 || len(state.Impact[0].UnresolvedQueryFamilies) != 0 {
		t.Fatalf("deprecation should be resolved by query v2: %+v", state.Impact)
	}
	out := filepath.Join(t.TempDir(), "projection")
	if err := writeProjection(out, valid, mustEmbedded(t, "contracts/meta.cue"), state); err != nil {
		t.Fatal(err)
	}
	if err := verifyProjectionManifest(out); err != nil {
		t.Fatal(err)
	}
	for _, rel := range []string{
		"events.jsonl", "meta.cue", "validation-report.json", "manifest.json",
		"jsonschema/contract-event.schema.json", "jsonschema/schema-catalog.json", "indexes/contract-index.json",
	} {
		if _, err := os.Stat(filepath.Join(out, filepath.FromSlash(rel))); err != nil {
			t.Fatalf("missing %s: %v", rel, err)
		}
	}
}

func TestAppendOnlyRewriteRejected(t *testing.T) {
	_, err := validateLedger(mustEmbedded(t, "fixtures/rewrite-mutated.contract.jsonl"), mustEmbedded(t, "fixtures/rewrite-base.contract.jsonl"))
	if err == nil || !strings.Contains(err.Error(), "rewritten") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestSemanticReferenceRejected(t *testing.T) {
	_, err := validateLedger(mustEmbedded(t, "fixtures/invalid-reference.contract.jsonl"), nil)
	if err == nil || !strings.Contains(err.Error(), "missing input field") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestInvalidShapeRejected(t *testing.T) {
	if _, err := validateLedger(mustEmbedded(t, "fixtures/invalid-shape.contract.jsonl"), nil); err == nil {
		t.Fatal("invalid shape accepted")
	}
}

func TestDuplicateJSONKeyRejected(t *testing.T) {
	line := `{"event_id":"evt_duplicate_0001","event_id":"evt_duplicate_0002","schema_version":"contract.meta.v1","created_at":"2026-08-16T00:00:00Z","purpose_level":"purpose","authority":"contract_owner","kind":"contract.schema.v1","schema_id":"dup.v1","title":"Duplicate","lifecycle":"active"}` + "\n"
	if _, err := validateLedger([]byte(line), nil); err == nil || !strings.Contains(err.Error(), "duplicate JSON key") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestLaterRegressionReopensDeprecationImpact(t *testing.T) {
	valid := append([]byte(nil), mustEmbedded(t, "fixtures/valid.contract.jsonl")...)
	query := `{"schema_version":"contract.meta.v1","created_at":"2026-08-16T00:00:00Z","purpose_level":"purpose","authority":"contract_owner","event_id":"evt_query_summary_v3_0016","kind":"contract.query.v1","query_id":"q_claim_summary.v3","query_family":"claim_summary","input_fields":["claim.v1#id","claim.v1#confidence","claim.v1#summary"],"output_schema":"claim_summary.v1","runner_kind":"go","projection_only":true,"side_effects":false,"fixture_ids":["fx_claim_summary_v3"],"expected_output_hash":"sha256:3333333333333333333333333333333333333333333333333333333333333333"}` + "\n"
	fixture := `{"schema_version":"contract.meta.v1","created_at":"2026-08-16T00:00:00Z","purpose_level":"purpose","authority":"contract_owner","event_id":"evt_fixture_summary_v3_0017","kind":"contract.fixture.v1","fixture_id":"fx_claim_summary_v3","target_query_id":"q_claim_summary.v3","polarity":"positive","payload_hash":"sha256:3333333333333333333333333333333333333333333333333333333333333333"}` + "\n"
	valid = append(valid, query...)
	valid = append(valid, fixture...)
	state, err := validateLedger(valid, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(state.Impact) != 1 || len(state.Impact[0].UnresolvedQueryFamilies) != 1 || state.Impact[0].UnresolvedQueryFamilies[0] != "claim_summary" {
		t.Fatalf("later regression should reopen impact: %+v", state.Impact)
	}
}

func mustEmbedded(t *testing.T, path string) []byte {
	t.Helper()
	data, err := embedded.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return data
}
