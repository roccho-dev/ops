package hq

import (
	"bytes"
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

func TestCLIProofBoundaryAndHelpMeanings(t *testing.T) {
	for _, args := range [][]string{nil, []string{"--json"}} {
		status, stdout, stderr := runCLIForTest(t, args...)
		if status != 0 || stderr != "" {
			t.Fatalf("boundary args=%v status=%d stdout=%q stderr=%q", args, status, stdout, stderr)
		}
		boundary := decodeJSONOutputForTest(t, stdout)
		for key, want := range (Object{
			"kind":                  "hq.modelingRuntime.goParityProof.boundary.v1",
			"canonicalPackage":      "hq-modeling-runtime",
			"ownerRepo":             "ops",
			"proofOnly":             true,
			"nonAuthority":          true,
			"cutoverReady":          false,
			"replacementAuthorized": false,
		}) {
			if boundary[key] != want {
				t.Fatalf("boundary %s=%#v, want %#v: %s", key, boundary[key], want, describeForTest(boundary))
			}
		}
	}

	status, stdout, stderr := runCLIForTest(t, "--help")
	if status != 0 || stderr != "" {
		t.Fatalf("help status=%d stderr=%q", status, stderr)
	}
	for _, fragment := range []string{
		"validate --input <queue.jsonl>",
		"work --input <queue.jsonl>",
		"receipts --input <queue.jsonl>",
		"projection --input <queue.jsonl>",
		"admit --input <queue.jsonl>",
		"promote --input <proposal.json> --confirmation <confirmation.json>",
	} {
		if !strings.Contains(stdout, fragment) {
			t.Fatalf("help missing %q:\n%s", fragment, stdout)
		}
	}
}

func TestCoreCLIRequiredSerializedMeanings(t *testing.T) {
	dir := t.TempDir()
	model := validModelForContract()
	agent := validAgentForContract()
	queuePath := writeJSONLFileForTest(t, dir, "queue.jsonl", model, agent)
	modelOnlyPath := writeJSONLFileForTest(t, dir, "model.jsonl", model)

	t.Run("validate plain and json", func(t *testing.T) {
		status, stdout, stderr := runCLIForTest(t, "validate", "--input", queuePath)
		if status != 0 || stderr != "" || !strings.Contains(stdout, "PASS records=2 errors=0") {
			t.Fatalf("plain validate status=%d stdout=%q stderr=%q", status, stdout, stderr)
		}
		status, stdout, stderr = runCLIForTest(t, "validate", "--input", queuePath, "--json")
		result := decodeJSONOutputForTest(t, stdout)
		if status != 0 || stderr != "" || result["ok"] != true || result["records"] != float64(2) {
			t.Fatalf("json validate status=%d result=%s stderr=%q", status, describeForTest(result), stderr)
		}
	})

	t.Run("work plain and json", func(t *testing.T) {
		status, stdout, stderr := runCLIForTest(t, "work", "--input", queuePath)
		if status != 0 || stderr != "" || !strings.Contains(stdout, "processed=1 pending=1 ignored=0 failed=0") {
			t.Fatalf("plain work status=%d stdout=%q stderr=%q", status, stdout, stderr)
		}
		status, stdout, stderr = runCLIForTest(t, "work", "--input", queuePath, "--json")
		result := decodeJSONOutputForTest(t, stdout)
		if status != 0 || stderr != "" || result["ok"] != true || result["processed"] != float64(1) || result["pending"] != float64(1) {
			t.Fatalf("json work status=%d result=%s stderr=%q", status, describeForTest(result), stderr)
		}
	})

	t.Run("receipt JSON and JSONL modes", func(t *testing.T) {
		status, stdout, stderr := runCLIForTest(t, "receipts", "--input", queuePath, "--json")
		result := decodeJSONOutputForTest(t, stdout)
		if status != 0 || stderr != "" || result["ok"] != true || result["receipts"] != float64(2) {
			t.Fatalf("receipt json status=%d result=%s stderr=%q", status, describeForTest(result), stderr)
		}
		status, stdout, stderr = runCLIForTest(t, "receipts", "--input", queuePath, "--jsonl")
		rows := decodeJSONLForTest(t, stdout)
		if status != 0 || stderr != "" || len(rows) != 2 || rows[0]["status"] != "processed" || rows[1]["status"] != "pending" {
			t.Fatalf("receipt jsonl status=%d rows=%s stderr=%q", status, describeForTest(objectSliceToAny(rows)), stderr)
		}
	})

	t.Run("projection JSON mode", func(t *testing.T) {
		status, stdout, stderr := runCLIForTest(t, "projection", "--input", queuePath, "--json")
		result := decodeJSONOutputForTest(t, stdout)
		projection := ensureObject(result["projection"])
		if status != 0 || stderr != "" || result["ok"] != true || projection["kind"] != "repoMap.projection.v1" || len(projection["edges"].([]any)) != 1 {
			t.Fatalf("projection status=%d result=%s stderr=%q", status, describeForTest(result), stderr)
		}
	})

	t.Run("admission JSON and both JSONL modes", func(t *testing.T) {
		status, stdout, stderr := runCLIForTest(t, "admit", "--input", modelOnlyPath, "--json")
		result := decodeJSONOutputForTest(t, stdout)
		if status != 0 || stderr != "" || result["ok"] != true || result["admitted"] != float64(1) || result["rejected"] != float64(0) {
			t.Fatalf("admit json status=%d result=%s stderr=%q", status, describeForTest(result), stderr)
		}
		status, stdout, stderr = runCLIForTest(t, "admit", "--input", modelOnlyPath, "--accepted-jsonl")
		rows := decodeJSONLForTest(t, stdout)
		if status != 0 || stderr != "" || len(rows) != 1 || rows[0]["kind"] != "accepted.modelCommit.v1" {
			t.Fatalf("accepted jsonl status=%d rows=%s stderr=%q", status, describeForTest(objectSliceToAny(rows)), stderr)
		}
		status, stdout, stderr = runCLIForTest(t, "admit", "--input", modelOnlyPath, "--receipt-jsonl")
		rows = decodeJSONLForTest(t, stdout)
		if status != 0 || stderr != "" || len(rows) != 1 || rows[0]["kind"] != "admission.receipt.v1" {
			t.Fatalf("receipt jsonl status=%d rows=%s stderr=%q", status, describeForTest(objectSliceToAny(rows)), stderr)
		}
	})

	t.Run("CLI usage and read failures preserve exit classes", func(t *testing.T) {
		for _, command := range []string{"validate", "work", "receipts", "projection", "admit"} {
			status, stdout, stderr := runCLIForTest(t, command)
			if status != 2 || stdout != "" || !strings.Contains(stderr, "usage:") {
				t.Fatalf("%s missing input status=%d stdout=%q stderr=%q", command, status, stdout, stderr)
			}
			status, stdout, stderr = runCLIForTest(t, command, "--input", filepath.Join(dir, "missing.jsonl"))
			if status != 1 || stdout != "" || stderr == "" {
				t.Fatalf("%s missing file status=%d stdout=%q stderr=%q", command, status, stdout, stderr)
			}
		}
		status, stdout, stderr := runCLIForTest(t, "unknown-command")
		if status != 2 || stdout != "" || !strings.Contains(stderr, "unknown argument") {
			t.Fatalf("unknown command status=%d stdout=%q stderr=%q", status, stdout, stderr)
		}
	})

	t.Run("serialized outputs are deterministic", func(t *testing.T) {
		for _, args := range [][]string{
			{"receipts", "--input", queuePath, "--jsonl"},
			{"projection", "--input", queuePath, "--json"},
			{"admit", "--input", modelOnlyPath, "--accepted-jsonl"},
		} {
			firstStatus, firstOut, firstErr := runCLIForTest(t, args...)
			secondStatus, secondOut, secondErr := runCLIForTest(t, args...)
			if firstStatus != secondStatus || firstOut != secondOut || firstErr != secondErr {
				t.Fatalf("nondeterministic %v\nfirst=(%d,%q,%q)\nsecond=(%d,%q,%q)", args, firstStatus, firstOut, firstErr, secondStatus, secondOut, secondErr)
			}
		}
	})
}

func TestPromotionCLIRequiredSerializedMeanings(t *testing.T) {
	dir := t.TempDir()
	proposal := validProposalForContract()
	confirmation := validConfirmationForContract(proposal)
	badConfirmation := cloneObjectForTest(t, confirmation)
	badConfirmation["proposalDigest"] = "sha256:wrong"

	proposalPath := writeJSONFileForTest(t, dir, "proposal.json", proposal)
	confirmationPath := writeJSONFileForTest(t, dir, "confirmation.json", confirmation)
	badConfirmationPath := writeJSONFileForTest(t, dir, "confirmation-bad.json", badConfirmation)
	invalidPath := filepath.Join(dir, "invalid.json")
	if err := os.WriteFile(invalidPath, []byte("{invalid json\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	proposalBefore, _ := os.ReadFile(proposalPath)
	confirmationBefore, _ := os.ReadFile(confirmationPath)
	initialEntries, _ := os.ReadDir(dir)

	t.Run("success modes expose one bounded artifact", func(t *testing.T) {
		status, stdout, stderr := runCLIForTest(t, "promote", "--input", proposalPath, "--confirmation", confirmationPath)
		if status != 0 || stderr != "" || !strings.HasPrefix(stdout, "hq proposal promotion: PASS ") {
			t.Fatalf("plain status=%d stdout=%q stderr=%q", status, stdout, stderr)
		}

		status, stdout, stderr = runCLIForTest(t, "promote", "--input", proposalPath, "--confirmation", confirmationPath, "--json")
		result := decodeJSONOutputForTest(t, stdout)
		if status != 0 || stderr != "" || result["ok"] != true || ensureObject(result["queueRow"])["kind"] != "hq.modelCommitQueued.v1" || ensureObject(result["promotionReceipt"])["kind"] != "proposal.promotionReceipt.v1" {
			t.Fatalf("json status=%d result=%s stderr=%q", status, describeForTest(result), stderr)
		}

		status, stdout, stderr = runCLIForTest(t, "promote", "--input", proposalPath, "--confirmation", confirmationPath, "--queue-jsonl")
		rows := decodeJSONLForTest(t, stdout)
		if status != 0 || stderr != "" || len(rows) != 1 || rows[0]["kind"] != "hq.modelCommitQueued.v1" {
			t.Fatalf("queue jsonl status=%d rows=%s stderr=%q", status, describeForTest(objectSliceToAny(rows)), stderr)
		}
		if _, exists := rows[0]["promotionReceipt"]; exists {
			t.Fatalf("queue row leaked receipt: %s", describeForTest(rows[0]))
		}

		status, stdout, stderr = runCLIForTest(t, "promote", "--input", proposalPath, "--confirmation", confirmationPath, "--receipt-jsonl")
		rows = decodeJSONLForTest(t, stdout)
		if status != 0 || stderr != "" || len(rows) != 1 || rows[0]["kind"] != "proposal.promotionReceipt.v1" || rows[0]["evidenceOnly"] != true || rows[0]["nonAuthority"] != true {
			t.Fatalf("receipt jsonl status=%d rows=%s stderr=%q", status, describeForTest(objectSliceToAny(rows)), stderr)
		}
	})

	t.Run("failed JSONL intent keeps stdout empty", func(t *testing.T) {
		cases := []struct {
			name string
			args []string
			code string
		}{
			{"queue bad digest", []string{"promote", "--input", proposalPath, "--confirmation", badConfirmationPath, "--queue-jsonl"}, "proposal-digest-mismatch"},
			{"receipt bad digest", []string{"promote", "--input", proposalPath, "--confirmation", badConfirmationPath, "--receipt-jsonl"}, "proposal-digest-mismatch"},
			{"queue invalid proposal", []string{"promote", "--input", invalidPath, "--confirmation", confirmationPath, "--queue-jsonl"}, "proposal-invalid-json"},
			{"receipt invalid confirmation", []string{"promote", "--input", proposalPath, "--confirmation", invalidPath, "--receipt-jsonl"}, "confirmation-invalid-json"},
			{"inline queue boolean", []string{"promote", "--input", proposalPath, "--confirmation", confirmationPath, "--queue-jsonl=true"}, "promotion-usage-error"},
			{"inline receipt boolean", []string{"promote", "--input", proposalPath, "--confirmation", confirmationPath, "--receipt-jsonl=true"}, "promotion-usage-error"},
			{"conflicting JSONL modes", []string{"promote", "--input", proposalPath, "--confirmation", confirmationPath, "--queue-jsonl", "--receipt-jsonl"}, "promotion-output-mode-conflict"},
			{"json and queue", []string{"promote", "--input", proposalPath, "--confirmation", confirmationPath, "--json", "--queue-jsonl"}, "promotion-output-mode-conflict"},
			{"missing confirmation queue", []string{"promote", "--input", proposalPath, "--queue-jsonl"}, "promotion-confirmation-required"},
			{"missing input receipt", []string{"promote", "--confirmation", confirmationPath, "--receipt-jsonl"}, "promotion-input-required"},
			{"unknown queue option", []string{"promote", "--input", proposalPath, "--confirmation", confirmationPath, "--queue-jsonl", "--unknown"}, "promotion-usage-error"},
		}
		for _, testCase := range cases {
			t.Run(testCase.name, func(t *testing.T) {
				status, stdout, stderr := runCLIForTest(t, testCase.args...)
				if status == 0 || stdout != "" || !strings.Contains(stderr, testCase.code) {
					t.Fatalf("status=%d stdout=%q stderr=%q", status, stdout, stderr)
				}
			})
		}
	})

	t.Run("JSON failures stay structured and never mint outputs", func(t *testing.T) {
		cases := []struct {
			name   string
			args   []string
			status int
			code   string
		}{
			{"bad digest", []string{"promote", "--input", proposalPath, "--confirmation", badConfirmationPath, "--json"}, 1, "proposal-digest-mismatch"},
			{"invalid proposal", []string{"promote", "--input", invalidPath, "--confirmation", confirmationPath, "--json"}, 1, "proposal-invalid-json"},
			{"invalid confirmation", []string{"promote", "--input", proposalPath, "--confirmation", invalidPath, "--json"}, 1, "confirmation-invalid-json"},
			{"missing proposal file", []string{"promote", "--input", filepath.Join(dir, "missing-proposal.json"), "--confirmation", confirmationPath, "--json"}, 1, "proposal-read-failed"},
			{"missing confirmation file", []string{"promote", "--input", proposalPath, "--confirmation", filepath.Join(dir, "missing-confirmation.json"), "--json"}, 1, "confirmation-read-failed"},
			{"missing confirmation arg", []string{"promote", "--input", proposalPath, "--json"}, 2, "promotion-confirmation-required"},
			{"missing input arg", []string{"promote", "--confirmation", confirmationPath, "--json"}, 2, "promotion-input-required"},
			{"unknown option", []string{"promote", "--input", proposalPath, "--confirmation", confirmationPath, "--json", "--unknown"}, 2, "promotion-usage-error"},
		}
		for _, testCase := range cases {
			t.Run(testCase.name, func(t *testing.T) {
				status, stdout, stderr := runCLIForTest(t, testCase.args...)
				if status != testCase.status || stderr != "" {
					t.Fatalf("status=%d want=%d stdout=%q stderr=%q", status, testCase.status, stdout, stderr)
				}
				result := decodeJSONOutputForTest(t, stdout)
				if result["ok"] != false || result["queueRow"] != nil {
					t.Fatalf("failure overclaimed output: %s", describeForTest(result))
				}
				if _, exists := result["promotionReceipt"]; exists {
					t.Fatalf("failure leaked receipt: %s", describeForTest(result))
				}
				requireCodeForTest(t, result, testCase.code)
			})
		}
	})

	t.Run("CLI is read only toward inputs and working directory", func(t *testing.T) {
		proposalAfter, _ := os.ReadFile(proposalPath)
		confirmationAfter, _ := os.ReadFile(confirmationPath)
		if !bytes.Equal(proposalBefore, proposalAfter) || !bytes.Equal(confirmationBefore, confirmationAfter) {
			t.Fatalf("CLI mutated inputs")
		}
		entriesAfter, _ := os.ReadDir(dir)
		if len(entriesAfter) != len(initialEntries) {
			t.Fatalf("CLI created files: before=%d after=%d", len(initialEntries), len(entriesAfter))
		}
	})
}
