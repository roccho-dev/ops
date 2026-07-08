package architecture

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestP13CoreResponsibilitiesAreSplitByPackage(t *testing.T) {
	root := repoRoot(t)
	expected := map[string][]string{
		"internal/core/validate":     {"func ValidateLedger", "func FastValidate", "func BuildIndex"},
		"internal/core/artifacts":    {"func GenerateArtifacts", "func VerifyGenerated", "func GenerateTS"},
		"internal/core/admission":    {"func Admit", "func VerifyCanonical"},
		"internal/core/authority":    {"func AuthorityCheck"},
		"internal/core/receipt":      {"func ReceiptCheck"},
		"internal/core/graph":        {"func GraphCheck"},
		"internal/core/sourcepolicy": {"func SourcePolicyCheck"},
		"internal/core/lineage":      {"func Lineage"},
		"internal/core/partition":    {"func Partition", "func VerifyPartition"},
	}
	for rel, needles := range expected {
		txt := readGoPackage(t, root, rel)
		for _, n := range needles {
			if !strings.Contains(txt, n) {
				t.Fatalf("%s missing %s", rel, n)
			}
		}
	}
}

func TestP13KernelPackageNoLongerOwnsCoreImplementation(t *testing.T) {
	root := repoRoot(t)
	kernelDir := filepath.Join(root, "internal/core/kernel")
	if _, err := os.Stat(kernelDir); err == nil {
		var goFiles []string
		err := filepath.WalkDir(kernelDir, func(path string, d os.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if !d.IsDir() && strings.HasSuffix(path, ".go") {
				goFiles = append(goFiles, path)
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
		if len(goFiles) > 0 {
			t.Fatalf("internal/core/kernel should be removed or non-Go facade only after P13, found %v", goFiles)
		}
	}
}

func TestP13CLIAndAdaptersWireConcretePackages(t *testing.T) {
	root := repoRoot(t)
	main := read(t, root, "cmd/contractcheck/main.go")
	forbidden := []string{"cueappendcontract/internal/core/kernel", "tools/contract_kernel.py", "proof/python/contract_kernel.py"}
	for _, f := range forbidden {
		if strings.Contains(main, f) {
			t.Fatalf("cmd/contractcheck/main.go still depends on legacy core surface %s", f)
		}
	}
	for _, rel := range []string{"internal/core/validate", "internal/core/artifacts", "internal/core/admission", "internal/core/authority", "internal/core/receipt", "internal/core/graph", "internal/core/sourcepolicy", "internal/core/lineage", "internal/core/partition"} {
		if !strings.Contains(main, rel) {
			t.Fatalf("cmd/contractcheck/main.go does not wire %s", rel)
		}
	}

	ts := read(t, root, "internal/adapters/typescript/adapter.go")
	if strings.Contains(ts, "internal/core/kernel") || !strings.Contains(ts, "internal/core/artifacts") || !strings.Contains(ts, "internal/core/validate") {
		t.Fatalf("TypeScript adapter should use split artifacts/validate packages, not kernel")
	}
	js := read(t, root, "internal/adapters/jsonschema/adapter.go")
	if strings.Contains(js, "internal/core/kernel") || !strings.Contains(js, "internal/core/artifacts") {
		t.Fatalf("JSON Schema adapter should use split artifacts package, not kernel")
	}
}
