package architecture

import (
	"strings"
	"testing"
)

func TestP12ContractCheckCLIIsThin(t *testing.T) {
	root := repoRoot(t)
	main := read(t, root, "cmd/contractcheck/main.go")
	if strings.Contains(main, "cueappendcontract/internal/core/kernel") {
		t.Fatalf("CLI should no longer delegate to legacy internal/core/kernel after P13")
	}
	forbidden := []string{
		"type Result struct", "type Index struct", "func FastValidate", "func SemanticCheck", "func GenerateSyntheticLedger",
		"cuelang.org/go/cue", "crypto/sha256", "math/rand",
	}
	for _, f := range forbidden {
		if strings.Contains(main, f) {
			t.Fatalf("cmd/contractcheck/main.go still owns core concern %q", f)
		}
	}
	if lines := strings.Count(main, "\n") + 1; lines > 260 {
		t.Fatalf("CLI main too large after P12: %d lines", lines)
	}
}

func TestP12CoreOwnsFormerProofKernelResponsibilities(t *testing.T) {
	root := repoRoot(t)
	required := map[string][]string{
		"internal/core/validate":     {"func ValidateLedger", "func GenerateSyntheticLedger", "func FastValidate", "func SemanticCheck"},
		"internal/core/artifacts":    {"func GenerateArtifacts", "func VerifyGenerated", "func GenerateTS", "func ContractEventSchema"},
		"internal/core/admission":    {"func Admit", "func VerifyCanonical"},
		"internal/core/authority":    {"func AuthorityCheck"},
		"internal/core/receipt":      {"func ReceiptCheck"},
		"internal/core/graph":        {"func GraphCheck"},
		"internal/core/sourcepolicy": {"func SourcePolicyCheck"},
		"internal/core/lineage":      {"func Lineage"},
		"internal/core/partition":    {"func Partition", "func VerifyPartition"},
	}
	for rel, needles := range required {
		txt := readGoPackage(t, root, rel)
		for _, n := range needles {
			if !strings.Contains(txt, n) {
				t.Fatalf("%s missing %s", rel, n)
			}
		}
	}
}

func TestP12AdaptersHaveImplementationFiles(t *testing.T) {
	root := repoRoot(t)
	for _, rel := range []string{"internal/adapters/typescript/adapter.go", "internal/adapters/jsonschema/adapter.go", "internal/adapters/duckdb/adapter.go"} {
		if !exists(root, rel) {
			t.Fatalf("adapter implementation missing: %s", rel)
		}
	}
}

func TestP12PhaseScriptsNoLongerCallPythonKernelForCoreChecks(t *testing.T) {
	root := repoRoot(t)
	scripts := []string{
		"scripts/test_p1_generated_integrity.sh", "scripts/test_p2_jsonschema_validator_generation.sh", "scripts/test_p3_ts_accessor_static_failure.sh",
		"scripts/test_p4_admission_gate.sh", "scripts/test_p5_authority_boundary.sh", "scripts/test_p6_receipt_ledger.sh", "scripts/test_p7_graph_checker.sh",
		"scripts/test_p8_source_policy.sh", "scripts/test_p9_lineage_impact_closure.sh", "scripts/test_p10_partition_snapshot_scale.sh",
	}
	for _, rel := range scripts {
		txt := read(t, root, rel)
		if strings.Contains(txt, "tools/contract_kernel.py") || strings.Contains(txt, "proof/python/contract_kernel.py") {
			t.Fatalf("%s still uses Python proof kernel for core check", rel)
		}
	}
}

func TestP12GeneratedManifestUsesGoCoreAfterRegeneration(t *testing.T) {
	root := repoRoot(t)
	manifest := read(t, root, "generated/core/manifest.json")
	if strings.Contains(manifest, "proof/python/contract_kernel.py") {
		t.Fatalf("generated manifest still declares Python proof kernel as generator")
	}
	if !(strings.Contains(manifest, "go/internal/core/kernel") || strings.Contains(manifest, "go/internal/core/artifacts")) {
		t.Fatalf("generated manifest should declare a Go core generator")
	}
}

func TestP12ProofPythonKernelRemainsProofOnly(t *testing.T) {
	root := repoRoot(t)
	if !exists(root, "proof/python/contract_kernel.py") {
		t.Fatalf("proof/python/contract_kernel.py should remain available as historical proof/helper")
	}
	for _, rel := range []string{"cmd/contractcheck", "internal/core/validate", "internal/core/artifacts", "internal/core/admission"} {
		txt := readGoPackage(t, root, rel)
		if strings.Contains(txt, "contract_kernel.py") {
			t.Fatalf("runtime/core file refers to Python proof kernel: %s", rel)
		}
	}
}
