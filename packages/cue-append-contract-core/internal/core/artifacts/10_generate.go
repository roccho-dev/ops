package artifacts

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

func GenerateArtifacts(opts ArtifactOptions) (map[string]any, error) {
	if opts.MetaPath == "" {
		opts.MetaPath = "contracts/meta.cue"
	}
	if opts.OutDir == "" {
		opts.OutDir = "generated"
	}
	events, err := ReadJSONL(opts.LedgerPath)
	if err != nil {
		return nil, err
	}
	idx, errs := BuildIndex(events)
	if len(errs) > 0 {
		return nil, fmt.Errorf("semantic errors: %s", strings.Join(limitStrings(errs, 10), "; "))
	}
	core := filepath.Join(opts.OutDir, "core")
	if err := os.RemoveAll(core); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(core, 0755); err != nil {
		return nil, err
	}
	if err := WriteJSON(filepath.Join(core, "jsonschema", "contract-event.schema.json"), ContractEventSchema()); err != nil {
		return nil, err
	}
	if err := WriteJSON(filepath.Join(core, "jsonschema", "schema-catalog.json"), GenerateSchemaCatalog(idx)); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Join(core, "ts"), 0755); err != nil {
		return nil, err
	}
	if err := os.WriteFile(filepath.Join(core, "ts", "accessors.ts"), []byte(GenerateTS(idx)), 0644); err != nil {
		return nil, err
	}
	if err := WriteJSON(filepath.Join(core, "indexes", "contract-index.json"), GenerateContractIndex(idx)); err != nil {
		return nil, err
	}
	cHash, err := HashFile(opts.LedgerPath)
	if err != nil {
		return nil, err
	}
	mHash, err := HashFile(opts.MetaPath)
	if err != nil {
		return nil, err
	}
	manifest := artifactManifest{Generator: "go/internal/core/artifacts", GeneratorVersion: GoGeneratorID, ContractLedger: opts.LedgerPath, MetaContract: opts.MetaPath, ContractSHA256: cHash, MetaSHA256: mHash, ArtifactHashes: ArtifactHashes(core), Scope: "generated/core"}
	if err := WriteJSON(filepath.Join(core, "manifest.json"), manifest); err != nil {
		return nil, err
	}
	return map[string]any{"status": "generated", "out": core, "artifacts": len(manifest.ArtifactHashes), "scope": "core", "generator": manifest.Generator}, nil
}

func VerifyGenerated(opts ArtifactOptions) (map[string]any, error) {
	if opts.OutDir == "" {
		opts.OutDir = "generated"
	}
	core := filepath.Join(opts.OutDir, "core")
	manifestPath := filepath.Join(core, "manifest.json")
	b, err := os.ReadFile(manifestPath)
	if err != nil {
		return nil, fmt.Errorf("generated core manifest missing: %w", err)
	}
	var manifest artifactManifest
	if err := json.Unmarshal(b, &manifest); err != nil {
		return nil, err
	}
	ledger := opts.LedgerPath
	if ledger == "" {
		ledger = manifest.ContractLedger
	}
	meta := opts.MetaPath
	if meta == "" {
		meta = manifest.MetaContract
	}
	errors := []string{}
	if h, err := HashFile(ledger); err != nil {
		errors = append(errors, err.Error())
	} else if h != manifest.ContractSHA256 {
		errors = append(errors, "contract_sha256 mismatch")
	}
	if h, err := HashFile(meta); err != nil {
		errors = append(errors, err.Error())
	} else if h != manifest.MetaSHA256 {
		errors = append(errors, "meta_sha256 mismatch")
	}
	for rel, expected := range manifest.ArtifactHashes {
		p := filepath.Join(core, filepath.FromSlash(rel))
		if _, err := os.Stat(p); err != nil {
			errors = append(errors, "missing artifact "+rel)
			continue
		}
		if h, err := HashFile(p); err != nil {
			errors = append(errors, err.Error())
		} else if h != expected {
			errors = append(errors, "artifact hash mismatch "+rel)
		}
	}
	tmp, err := os.MkdirTemp("", "contractcheck-regen-*")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(tmp)
	if _, err := GenerateArtifacts(ArtifactOptions{LedgerPath: ledger, MetaPath: meta, OutDir: filepath.Join(tmp, "generated")}); err != nil {
		return nil, err
	}
	diffs := CompareDirs(core, filepath.Join(tmp, "generated", "core"))
	errors = append(errors, diffs...)
	if len(errors) > 0 {
		return nil, fmt.Errorf("generated integrity failed: %s", strings.Join(limitStrings(errors, 20), "; "))
	}
	return map[string]any{"status": "pass", "check": "generated-integrity", "artifacts": len(manifest.ArtifactHashes), "scope": "core", "generator": manifest.Generator}, nil
}
