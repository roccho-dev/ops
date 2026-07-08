package artifacts

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

func ValidateGeneratedJSONSchema(ledgerPath, generatedDir string) (map[string]any, error) {
	schemaPath := filepath.Join(generatedDir, "core", "jsonschema", "contract-event.schema.json")
	if _, err := os.Stat(schemaPath); err != nil {
		return nil, fmt.Errorf("generated JSON Schema missing: %w", err)
	}
	events, err := ReadJSONL(ledgerPath)
	if err != nil {
		return nil, err
	}
	errors := []string{}
	for _, ev := range events {
		if errs := FastValidate(ev); len(errs) > 0 {
			errors = append(errors, fmt.Sprintf("line %v: %s", ev["__line__"], strings.Join(errs, "; ")))
		}
	}
	if len(errors) > 0 {
		return nil, fmt.Errorf("generated JSON Schema validation failed: %s", strings.Join(limitStrings(errors, 20), "; "))
	}
	return map[string]any{"status": "pass", "check": "jsonschema-validation", "ledger": ledgerPath, "schema": schemaPath, "engine": "go-fast-generated-parity"}, nil
}
