package jsonschema

import (
	"os"
	"path/filepath"
	"testing"
)

func TestExporterWritesSchemaAndImplementsPort(t *testing.T) {
	dir := t.TempDir()
	if err := (Exporter{}).Export(dir); err != nil {
		t.Fatal(err)
	}
	p := filepath.Join(dir, "contract-event.schema.json")
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	if len(b) == 0 || !(Exporter{}).Exists(dir) {
		t.Fatalf("schema export missing or empty")
	}
}
