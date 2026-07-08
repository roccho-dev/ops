package typescript

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"cueappendcontract/internal/core/validate"
)

func TestAccessorGeneratorWritesGeneratedAccessors(t *testing.T) {
	events := []validate.Event{
		{"kind": "contract.schema.v1", "event_id": "evt_0000001", "schema_id": "claim.v1", "title": "Claim", "lifecycle": "active"},
		{"kind": "contract.field.v1", "event_id": "evt_0000002", "schema_id": "claim.v1", "field_id": "confidence", "field_type": "number", "required": true, "pii": false, "description": "confidence"},
	}
	idx, errs := validate.BuildIndex(events)
	if len(errs) > 0 {
		t.Fatalf("unexpected index errors: %v", errs)
	}
	dir := t.TempDir()
	if err := (AccessorGenerator{}).GenerateFromIndex(idx, dir); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(filepath.Join(dir, "accessors.ts"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), "Claim") || !strings.Contains(string(b), "confidence") {
		t.Fatalf("generated accessor missing schema or field: %s", string(b))
	}
}
