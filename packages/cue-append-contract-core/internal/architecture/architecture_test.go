package architecture

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func repoRoot(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatal("go.mod not found")
		}
		dir = parent
	}
}

func read(t *testing.T, root string, rel string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(root, rel))
	if err != nil {
		t.Fatalf("read %s: %v", rel, err)
	}
	return string(b)
}

func exists(root string, rel string) bool {
	_, err := os.Stat(filepath.Join(root, rel))
	return err == nil
}

func TestPythonKernelIsProofOnlyAndToolIsWrapper(t *testing.T) {
	root := repoRoot(t)
	if !exists(root, "proof/python/contract_kernel.py") {
		t.Fatalf("proof/python/contract_kernel.py missing")
	}
	tool := read(t, root, "tools/contract_kernel.py")
	if !(strings.Contains(tool, "proof/python/contract_kernel.py") || strings.Contains(tool, "\"proof\" / \"python\"")) || !strings.Contains(tool, "runpy.run_path") {
		t.Fatalf("tools/contract_kernel.py must be a compatibility wrapper into proof/python")
	}
	forbidden := []string{"def cmd_generate_artifacts", "def cmd_admit", "def cmd_authority_check", "def cmd_graph_check"}
	for _, f := range forbidden {
		if strings.Contains(tool, f) {
			t.Fatalf("tools/contract_kernel.py contains proof kernel implementation %q", f)
		}
	}
}

func TestCoreBoundaryHasNoPythonOrDuckDBDependency(t *testing.T) {
	root := repoRoot(t)
	for _, rel := range []string{"internal/core", "internal/ports", "internal/adapters/typescript", "internal/adapters/jsonschema", "internal/adapters/duckdb", "contracts/meta.cue"} {
		if !exists(root, rel) {
			t.Fatalf("required boundary path missing: %s", rel)
		}
	}
	for _, rel := range []string{"generated/jsonschema", "generated/ts", "generated/indexes", "generated/lineage", "generated/partitions"} {
		if exists(root, rel) {
			t.Fatalf("legacy generated scope still exists: %s", rel)
		}
	}
	var pyInCore []string
	err := filepath.WalkDir(filepath.Join(root, "internal"), func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !d.IsDir() && strings.HasSuffix(path, ".py") {
			pyInCore = append(pyInCore, path)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(pyInCore) > 0 {
		t.Fatalf("python files found under internal core/adapter boundary: %v", pyInCore)
	}
	mod := read(t, root, "go.mod")
	for _, dep := range []string{"duckdb", "sqlglot", "ajv", "typescript"} {
		if strings.Contains(strings.ToLower(mod), dep) {
			t.Fatalf("go.mod should not pull %s into Go+CUE+JSONL core", dep)
		}
	}
}

func readGoPackage(t *testing.T, root, rel string) string {
	t.Helper()
	var b strings.Builder
	err := filepath.WalkDir(filepath.Join(root, rel), func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		b.Write(data)
		b.WriteByte('\n')
		return nil
	})
	if err != nil {
		t.Fatalf("read package %s: %v", rel, err)
	}
	return b.String()
}
