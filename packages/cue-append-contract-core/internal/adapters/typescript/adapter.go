package typescript

import (
	"os"
	"path/filepath"

	"cueappendcontract/internal/core/artifacts"
	"cueappendcontract/internal/core/validate"
	"cueappendcontract/internal/ports"
)

var _ ports.ArtifactGenerator = AccessorGenerator{}

// AccessorGenerator writes TypeScript accessors as an optional static-check surface.
type AccessorGenerator struct{}

// Generate satisfies ports.ArtifactGenerator for TypeScript accessor output.
func (AccessorGenerator) Generate(ledgerPath string, outDir string) error {
	events, err := validate.ReadJSONL(ledgerPath)
	if err != nil {
		return err
	}
	idx, errs := validate.BuildIndex(events)
	if len(errs) > 0 {
		return &GenerationError{Errors: errs}
	}
	return AccessorGenerator{}.GenerateFromIndex(idx, outDir)
}

func (AccessorGenerator) GenerateFromIndex(idx validate.Index, outDir string) error {
	if err := os.MkdirAll(outDir, 0755); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(outDir, "accessors.ts"), []byte(artifacts.GenerateTS(idx)), 0644)
}

type GenerationError struct{ Errors []string }

func (e *GenerationError) Error() string { return "typescript accessor generation failed" }
