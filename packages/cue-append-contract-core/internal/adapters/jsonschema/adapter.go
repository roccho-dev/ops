package jsonschema

import (
	"os"
	"path/filepath"

	"cueappendcontract/internal/core/artifacts"
	"cueappendcontract/internal/core/validate"
	"cueappendcontract/internal/ports"
)

var _ ports.ArtifactGenerator = Exporter{}

// Exporter writes JSON Schema exchange artifacts derived from contract JSONL.
type Exporter struct{}

// Generate satisfies ports.ArtifactGenerator. It delegates to the split artifacts
// package and does not become an independent schema authority.
func (Exporter) Generate(ledgerPath string, outDir string) error {
	_, err := artifacts.GenerateArtifacts(artifacts.ArtifactOptions{LedgerPath: ledgerPath, OutDir: outDir})
	return err
}

func (Exporter) Export(outDir string) error {
	return validate.WriteJSON(filepath.Join(outDir, "contract-event.schema.json"), artifacts.ContractEventSchema())
}

func (Exporter) Exists(outDir string) bool {
	_, err := os.Stat(filepath.Join(outDir, "contract-event.schema.json"))
	return err == nil
}
