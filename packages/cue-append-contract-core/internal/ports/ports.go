package ports

import "cueappendcontract/internal/core/contract"

// RowValidator validates one contract JSONL row against a contract surface.
type RowValidator interface {
	ValidateRow(contract.Event) []error
}

// ArtifactGenerator produces deterministic generated artifacts from canonical contract JSONL.
type ArtifactGenerator interface {
	Generate(ledgerPath string, outDir string) error
}

// StaticTypeChecker runs an optional SDK/projection compile check such as tsc/tsgo.
type StaticTypeChecker interface {
	Check(projectPath string) error
}

// LedgerStore admits or reads canonical ledgers. Draft/raw writes must pass admission first.
type LedgerStore interface {
	AppendCanonical(contract.Event) error
	ReadCanonical() ([]contract.Event, error)
}

// ReceiptWriter records validation, generation, projection, migration, and action receipts.
type ReceiptWriter interface {
	WriteReceipt(contract.Event) error
}
