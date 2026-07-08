package artifacts

import validate "cueappendcontract/internal/core/validate"

type ArtifactOptions struct{ LedgerPath, MetaPath, OutDir string }

type artifactManifest struct {
	Generator        string            `json:"generator"`
	GeneratorVersion string            `json:"generator_version"`
	ContractLedger   string            `json:"contract_ledger"`
	MetaContract     string            `json:"meta_contract"`
	ContractSHA256   string            `json:"contract_sha256"`
	MetaSHA256       string            `json:"meta_sha256"`
	ArtifactHashes   map[string]string `json:"artifact_hashes"`
	Scope            string            `json:"scope"`
}

type Index = validate.Index
type Field = validate.Field
type Query = validate.Query

const GoGeneratorID = validate.GoGeneratorID

var (
	ReadJSONL    = validate.ReadJSONL
	BuildIndex   = validate.BuildIndex
	WriteJSON    = validate.WriteJSON
	HashFile     = validate.HashFile
	FastValidate = validate.FastValidate
)
