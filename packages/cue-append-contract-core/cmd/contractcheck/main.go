package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"

	"cueappendcontract/internal/core/admission"
	"cueappendcontract/internal/core/appendonly"
	"cueappendcontract/internal/core/artifacts"
	"cueappendcontract/internal/core/authority"
	"cueappendcontract/internal/core/graph"
	"cueappendcontract/internal/core/lineage"
	"cueappendcontract/internal/core/partition"
	"cueappendcontract/internal/core/receipt"
	"cueappendcontract/internal/core/sourcepolicy"
	"cueappendcontract/internal/core/validate"
)

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	var out any
	var err error
	switch os.Args[1] {
	case "validate":
		out, err = cmdValidate(os.Args[2:])
	case "generate":
		out, err = cmdGenerate(os.Args[2:])
	case "generate-artifacts":
		out, err = cmdGenerateArtifacts(os.Args[2:])
	case "verify-generated":
		out, err = cmdVerifyGenerated(os.Args[2:])
	case "validate-jsonschema":
		out, err = cmdValidateJSONSchema(os.Args[2:])
	case "admit":
		out, err = cmdAdmit(os.Args[2:])
	case "verify-canonical":
		out, err = cmdVerifyCanonical(os.Args[2:])
	case "append-only-check":
		out, err = cmdAppendOnlyCheck(os.Args[2:])
	case "authority-check":
		out, err = cmdAuthorityCheck(os.Args[2:])
	case "receipt-check":
		out, err = cmdReceiptCheck(os.Args[2:])
	case "graph-check":
		out, err = cmdGraphCheck(os.Args[2:])
	case "source-policy-check":
		out, err = cmdSourcePolicyCheck(os.Args[2:])
	case "lineage":
		out, err = cmdLineage(os.Args[2:])
	case "partition":
		out, err = cmdPartition(os.Args[2:])
	case "verify-partition":
		out, err = cmdVerifyPartition(os.Args[2:])
	default:
		usage()
		os.Exit(2)
	}
	if out != nil {
		printJSON(out)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "ERROR:", err)
		os.Exit(1)
	}
}

func usage() {
	fmt.Println(`contractcheck validates append-only contract JSONL with a small CUE meta-contract.

Commands:
  validate --meta contracts/meta.cue --ledger ledgers/contract.jsonl --report proof/report.json
  generate --out ledgers/large.contract.jsonl --schemas 1000 --fields 12 --queries 5000 --edges 2000 --fixtures true
  generate-artifacts --ledger ledgers/small_after_fix.contract.jsonl --meta contracts/meta.cue --out generated
  verify-generated --ledger ledgers/small_after_fix.contract.jsonl --meta contracts/meta.cue --out generated
  validate-jsonschema --ledger ledgers/small_after_fix.contract.jsonl --generated generated
  admit --draft ledgers/small_after_fix.contract.jsonl --canonical runtime/canonical.contract.jsonl --receipt runtime/admission_receipts.jsonl
  verify-canonical --canonical runtime/canonical.contract.jsonl --receipt runtime/admission_receipts.jsonl
  append-only-check --base ledgers/small_before_fix.contract.jsonl --candidate ledgers/small_after_fix.contract.jsonl
  authority-check --attempts fixtures/authority/valid_decision_attempts.jsonl
  receipt-check --receipts fixtures/receipt/valid_receipts.jsonl
  graph-check --ledger ledgers/small_after_fix.contract.jsonl
  source-policy-check --ledger fixtures/source/valid_source_policy.jsonl
  lineage --ledger ledgers/small_after_fix.contract.jsonl --out generated/projections/lineage
  partition --ledger ledgers/stress_500k.contract.jsonl.gz --out generated/cache/partitions/stress_500k --chunk-lines 100000
  verify-partition --out generated/cache/partitions/stress_500k`)
}

func cmdValidate(args []string) (any, error) {
	fs := flag.NewFlagSet("validate", flag.ContinueOnError)
	meta := fs.String("meta", "contracts/meta.cue", "CUE meta-contract path")
	ledger := fs.String("ledger", "", "contract JSONL path")
	report := fs.String("report", "", "optional JSON report path")
	rowValidator := fs.String("row-validator", "cue", "row validator: cue, fast, or both")
	cueSample := fs.Int("cue-sample", 0, "also validate first N rows with CUE when using fast mode")
	if err := fs.Parse(args); err != nil {
		return nil, err
	}
	res, err := validate.ValidateLedger(validate.ValidateOptions{MetaPath: *meta, LedgerPath: *ledger, ReportPath: *report, RowValidator: *rowValidator, CueSample: *cueSample})
	return res, err
}

func cmdGenerate(args []string) (any, error) {
	fs := flag.NewFlagSet("generate", flag.ContinueOnError)
	out := fs.String("out", "ledgers/large.contract.jsonl", "output JSONL")
	schemas := fs.Int("schemas", 1000, "schema count")
	fields := fs.Int("fields", 10, "fields per schema")
	queries := fs.Int("queries", 5000, "query count")
	edges := fs.Int("edges", 2000, "edge count")
	fixtures := fs.Bool("fixtures", true, "include fixtures")
	if err := fs.Parse(args); err != nil {
		return nil, err
	}
	err := validate.GenerateSyntheticLedger(validate.GenerateOptions{OutPath: *out, Schemas: *schemas, Fields: *fields, Queries: *queries, Edges: *edges, Fixtures: *fixtures})
	return map[string]any{"status": "generated", "out": *out}, err
}

func cmdGenerateArtifacts(args []string) (any, error) {
	fs := flag.NewFlagSet("generate-artifacts", flag.ContinueOnError)
	ledger := fs.String("ledger", "", "")
	meta := fs.String("meta", "contracts/meta.cue", "")
	out := fs.String("out", "generated", "")
	if err := fs.Parse(args); err != nil {
		return nil, err
	}
	return artifacts.GenerateArtifacts(artifacts.ArtifactOptions{LedgerPath: *ledger, MetaPath: *meta, OutDir: *out})
}
func cmdVerifyGenerated(args []string) (any, error) {
	fs := flag.NewFlagSet("verify-generated", flag.ContinueOnError)
	ledger := fs.String("ledger", "", "")
	meta := fs.String("meta", "", "")
	out := fs.String("out", "generated", "")
	if err := fs.Parse(args); err != nil {
		return nil, err
	}
	return artifacts.VerifyGenerated(artifacts.ArtifactOptions{LedgerPath: *ledger, MetaPath: *meta, OutDir: *out})
}
func cmdValidateJSONSchema(args []string) (any, error) {
	fs := flag.NewFlagSet("validate-jsonschema", flag.ContinueOnError)
	ledger := fs.String("ledger", "", "")
	generated := fs.String("generated", "generated", "")
	if err := fs.Parse(args); err != nil {
		return nil, err
	}
	return artifacts.ValidateGeneratedJSONSchema(*ledger, *generated)
}
func cmdAdmit(args []string) (any, error) {
	fs := flag.NewFlagSet("admit", flag.ContinueOnError)
	draft := fs.String("draft", "", "")
	canonical := fs.String("canonical", "", "")
	rec := fs.String("receipt", "", "")
	generated := fs.String("generated", "generated", "")
	if err := fs.Parse(args); err != nil {
		return nil, err
	}
	return admission.Admit(admission.AdmissionOptions{Draft: *draft, Canonical: *canonical, Receipt: *rec, Generated: *generated})
}
func cmdVerifyCanonical(args []string) (any, error) {
	fs := flag.NewFlagSet("verify-canonical", flag.ContinueOnError)
	canonical := fs.String("canonical", "", "")
	rec := fs.String("receipt", "", "")
	if err := fs.Parse(args); err != nil {
		return nil, err
	}
	return admission.VerifyCanonical(*canonical, *rec)
}
func cmdAppendOnlyCheck(args []string) (any, error) {
	fs := flag.NewFlagSet("append-only-check", flag.ContinueOnError)
	base := fs.String("base", "", "previous ledger path")
	candidate := fs.String("candidate", "", "candidate ledger path")
	if err := fs.Parse(args); err != nil {
		return nil, err
	}
	return appendonly.Check(*base, *candidate)
}
func cmdAuthorityCheck(args []string) (any, error) {
	fs := flag.NewFlagSet("authority-check", flag.ContinueOnError)
	attempts := fs.String("attempts", "", "")
	if err := fs.Parse(args); err != nil {
		return nil, err
	}
	return authority.AuthorityCheck(*attempts)
}
func cmdReceiptCheck(args []string) (any, error) {
	fs := flag.NewFlagSet("receipt-check", flag.ContinueOnError)
	receipts := fs.String("receipts", "", "")
	if err := fs.Parse(args); err != nil {
		return nil, err
	}
	return receipt.ReceiptCheck(*receipts)
}
func cmdGraphCheck(args []string) (any, error) {
	fs := flag.NewFlagSet("graph-check", flag.ContinueOnError)
	ledger := fs.String("ledger", "", "")
	if err := fs.Parse(args); err != nil {
		return nil, err
	}
	return graph.GraphCheck(*ledger)
}
func cmdSourcePolicyCheck(args []string) (any, error) {
	fs := flag.NewFlagSet("source-policy-check", flag.ContinueOnError)
	ledger := fs.String("ledger", "", "")
	if err := fs.Parse(args); err != nil {
		return nil, err
	}
	return sourcepolicy.SourcePolicyCheck(*ledger)
}
func cmdLineage(args []string) (any, error) {
	fs := flag.NewFlagSet("lineage", flag.ContinueOnError)
	ledger := fs.String("ledger", "", "")
	out := fs.String("out", "", "")
	if err := fs.Parse(args); err != nil {
		return nil, err
	}
	return lineage.Lineage(*ledger, *out)
}
func cmdPartition(args []string) (any, error) {
	fs := flag.NewFlagSet("partition", flag.ContinueOnError)
	ledger := fs.String("ledger", "", "")
	out := fs.String("out", "", "")
	chunk := fs.Int("chunk-lines", 50000, "")
	if err := fs.Parse(args); err != nil {
		return nil, err
	}
	return partition.Partition(*ledger, *out, *chunk)
}
func cmdVerifyPartition(args []string) (any, error) {
	fs := flag.NewFlagSet("verify-partition", flag.ContinueOnError)
	out := fs.String("out", "", "")
	if err := fs.Parse(args); err != nil {
		return nil, err
	}
	return partition.VerifyPartition(*out)
}

func printJSON(v any) { b, _ := json.MarshalIndent(v, "", "  "); fmt.Println(string(b)) }
