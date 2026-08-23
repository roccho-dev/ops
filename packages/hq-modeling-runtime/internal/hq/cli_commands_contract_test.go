package hq

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func decodeJSONLForTest(t *testing.T, text string) []Object {
	t.Helper()
	rows := []Object{}
	result := VisitJSONLLines(strings.NewReader(text), func(line int, trimmed []byte) {
		value, parseError := ParseJSONLine(trimmed, line)
		if parseError != nil {
			t.Fatalf("invalid JSONL line %d: %s", line, describeForTest(parseError))
		}
		object, ok := AsObject(value)
		if !ok {
			t.Fatalf("JSONL line %d is not object: %#v", line, value)
		}
		rows = append(rows, object)
	})
	if result != nil {
		t.Fatal(result)
	}
	return rows
}

func writeJSONLFileForTest(t *testing.T, dir, name string, rows ...any) string {
	t.Helper()
	encoded, err := RowsToJSONL(rows)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, encoded, 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestCLICommandsPreserveJSONLContracts(t *testing.T) {
	dir := t.TempDir()
	queue := writeJSONLFileForTest(t, dir, "queue.jsonl", validModelForContract(), validAgentForContract())
	model := writeJSONLFileForTest(t, dir, "model.jsonl", validModelForContract())

	status, stdout, stderr := runCLIForTest(t, "validate", "--input", queue, "--json")
	result := decodeJSONOutputForTest(t, stdout)
	if status != 0 || stderr != "" {
		t.Fatalf("validate status=%d stderr=%q", status, stderr)
	}
	requireFields(t, result, Object{"ok": true, "records": float64(2)})

	status, stdout, stderr = runCLIForTest(t, "work", "--input", queue, "--json")
	result = decodeJSONOutputForTest(t, stdout)
	if status != 0 || stderr != "" {
		t.Fatalf("work status=%d stderr=%q", status, stderr)
	}
	requireFields(t, result, Object{"ok": true, "processed": float64(1), "pending": float64(1)})

	status, stdout, stderr = runCLIForTest(t, "receipts", "--input", queue, "--jsonl")
	rows := decodeJSONLForTest(t, stdout)
	if status != 0 || stderr != "" || len(rows) != 2 {
		t.Fatalf("receipts status=%d rows=%s stderr=%q", status, describeForTest(objectSliceToAny(rows)), stderr)
	}
	requireFields(t, rows[0], Object{"status": "processed"})
	requireFields(t, rows[1], Object{"status": "pending"})

	status, stdout, stderr = runCLIForTest(t, "projection", "--input", queue, "--json")
	result = decodeJSONOutputForTest(t, stdout)
	projection := ensureObject(result["projection"])
	if status != 0 || stderr != "" || len(projection["edges"].([]any)) != 1 {
		t.Fatalf("projection status=%d result=%s stderr=%q", status, describeForTest(result), stderr)
	}
	requireFields(t, projection, Object{"kind": "repoMap.projection.v1"})

	status, stdout, stderr = runCLIForTest(t, "admit", "--input", model, "--accepted-jsonl")
	rows = decodeJSONLForTest(t, stdout)
	if status != 0 || stderr != "" || len(rows) != 1 {
		t.Fatalf("admit status=%d rows=%s stderr=%q", status, describeForTest(objectSliceToAny(rows)), stderr)
	}
	requireFields(t, rows[0], Object{"kind": "accepted.modelCommit.v1"})

	for _, command := range []string{"validate", "work", "receipts", "projection", "admit"} {
		status, stdout, stderr = runCLIForTest(t, command)
		if status != 2 || stdout != "" || !strings.Contains(stderr, "usage:") {
			t.Fatalf("%s missing input status=%d stdout=%q stderr=%q", command, status, stdout, stderr)
		}
		status, stdout, stderr = runCLIForTest(t, command, "--input", filepath.Join(dir, "missing.jsonl"))
		if status != 1 || stdout != "" || stderr == "" {
			t.Fatalf("%s missing file status=%d stdout=%q stderr=%q", command, status, stdout, stderr)
		}
	}

	firstStatus, firstOut, firstErr := runCLIForTest(t, "projection", "--input", queue, "--json")
	secondStatus, secondOut, secondErr := runCLIForTest(t, "projection", "--input", queue, "--json")
	if firstStatus != secondStatus || firstOut != secondOut || firstErr != secondErr {
		t.Fatal("projection output is not deterministic")
	}
}
