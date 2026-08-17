package forge

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRunProjectionRecordsDeclaredOutputHash(t *testing.T) {
	root := t.TempDir()
	dist := filepath.Join(root, "dist")
	capDir := filepath.Join(root, "capabilities", "demo")
	if err := os.MkdirAll(capDir, 0o755); err != nil {
		t.Fatal(err)
	}
	payload := filepath.Join(root, "projector")
	script := "#!/bin/sh\n/bin/mkdir -p \"$(/usr/bin/dirname \"$1\")\"\nprintf 'projection\\n' > \"$1\"\n"
	if err := os.WriteFile(payload, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	spec := `{"schema":"capability-projection/1","args":["{dist}/contracts/demo.txt"],"outputs":["contracts/demo.txt"],"timeoutMs":2000}`
	if err := os.WriteFile(filepath.Join(capDir, "projection.json"), []byte(spec), 0o644); err != nil {
		t.Fatal(err)
	}
	result := runProjection(root, dist, payload, capDir)
	if result == nil || result.Status != "PASS" {
		t.Fatalf("unexpected result: %+v", result)
	}
	if got := result.Outputs["./contracts/demo.txt"]; got == "" {
		t.Fatalf("missing output hash: %+v", result.Outputs)
	}
}

func TestProjectionRejectsUndeclaredOutput(t *testing.T) {
	root := t.TempDir()
	dist := filepath.Join(root, "dist")
	capDir := filepath.Join(root, "capabilities", "demo")
	if err := os.MkdirAll(capDir, 0o755); err != nil {
		t.Fatal(err)
	}
	payload := filepath.Join(root, "projector")
	script := "#!/bin/sh\n/bin/mkdir -p \"$1\"\nprintf declared > \"$1/declared.txt\"\nprintf extra > \"$1/extra.txt\"\n"
	if err := os.WriteFile(payload, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	spec := `{"schema":"capability-projection/1","args":["{dist}/contracts"],"outputs":["contracts/declared.txt"],"timeoutMs":2000}`
	if err := os.WriteFile(filepath.Join(capDir, "projection.json"), []byte(spec), 0o644); err != nil {
		t.Fatal(err)
	}
	result := runProjection(root, dist, payload, capDir)
	if result == nil || result.Status != "FAIL" || result.Error != "undeclared projection output: contracts/extra.txt" {
		t.Fatalf("unexpected result: %+v", result)
	}
}

func TestProjectionRejectsOutputOutsideDist(t *testing.T) {
	root := t.TempDir()
	dist := filepath.Join(root, "dist")
	capDir := filepath.Join(root, "capabilities", "demo")
	if err := os.MkdirAll(capDir, 0o755); err != nil {
		t.Fatal(err)
	}
	payload := filepath.Join(root, "projector")
	if err := os.WriteFile(payload, []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	spec := `{"schema":"capability-projection/1","args":["noop"],"outputs":["../escape.txt"],"timeoutMs":2000}`
	if err := os.WriteFile(filepath.Join(capDir, "projection.json"), []byte(spec), 0o644); err != nil {
		t.Fatal(err)
	}
	result := runProjection(root, dist, payload, capDir)
	if result == nil || result.Status != "FAIL" {
		t.Fatalf("unexpected result: %+v", result)
	}
}

func TestProjectionInputChangeDoesNotInvalidateBuildDigest(t *testing.T) {
	root := t.TempDir()
	capDir := filepath.Join(root, "capabilities", "demo")
	if err := os.MkdirAll(filepath.Join(capDir, "ledgers"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "go.mod"), []byte("module example.test/demo\n\ngo 1.23\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	mainPath := filepath.Join(capDir, "main.go")
	if err := os.WriteFile(mainPath, []byte("package main\nfunc main() {}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	ledgerPath := filepath.Join(capDir, "ledgers", "events.jsonl")
	if err := os.WriteFile(ledgerPath, []byte("{\"id\":1}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	specPath := filepath.Join(capDir, "projection.json")
	specJSON := `{"schema":"capability-projection/1","inputs":["ledgers/events.jsonl"],"args":["noop"],"outputs":["projection/out.json"],"timeoutMs":2000}`
	if err := os.WriteFile(specPath, []byte(specJSON), 0o644); err != nil {
		t.Fatal(err)
	}
	spec, err := readProjectionSpec(specPath)
	if err != nil {
		t.Fatal(err)
	}
	inputs, exclusions, err := projectionInputs(root, capDir, spec)
	if err != nil {
		t.Fatal(err)
	}
	if len(inputs) != 1 {
		t.Fatalf("unexpected inputs: %+v", inputs)
	}
	first, err := sourceDigest(root, capDir, "test-build", exclusions)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(ledgerPath, []byte("{\"id\":1}\n{\"id\":2}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	second, err := sourceDigest(root, capDir, "test-build", exclusions)
	if err != nil {
		t.Fatal(err)
	}
	if first != second {
		t.Fatalf("projection-only input changed build digest: %s != %s", first, second)
	}
	if err := os.WriteFile(mainPath, []byte("package main\nfunc main() { println(1) }\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	third, err := sourceDigest(root, capDir, "test-build", exclusions)
	if err != nil {
		t.Fatal(err)
	}
	if third == second {
		t.Fatal("Go source change did not invalidate build digest")
	}
}
