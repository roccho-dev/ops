package hq

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPromotionCLIIsReadOnlyAndFailClosed(t *testing.T) {
	dir := t.TempDir()
	proposal := validProposalForContract()
	confirmation := validConfirmationForContract(proposal)
	bad := cloneObjectForTest(t, confirmation)
	bad["proposalDigest"] = "sha256:wrong"

	proposalPath := writeJSONFileForTest(t, dir, "proposal.json", proposal)
	confirmationPath := writeJSONFileForTest(t, dir, "confirmation.json", confirmation)
	badPath := writeJSONFileForTest(t, dir, "confirmation-bad.json", bad)
	invalidPath := filepath.Join(dir, "invalid.json")
	if err := os.WriteFile(invalidPath, []byte("{invalid json\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	proposalBefore, _ := os.ReadFile(proposalPath)
	confirmationBefore, _ := os.ReadFile(confirmationPath)
	entriesBefore, _ := os.ReadDir(dir)

	status, stdout, stderr := runCLIForTest(t, "promote", "--input", proposalPath, "--confirmation", confirmationPath, "--json")
	result := decodeJSONOutputForTest(t, stdout)
	if status != 0 || stderr != "" {
		t.Fatalf("promotion status=%d stderr=%q", status, stderr)
	}
	requireFields(t, result, Object{"ok": true})
	requireFields(t, ensureObject(result["queueRow"]), Object{"kind": "hq.modelCommitQueued.v1"})
	requireFields(t, ensureObject(result["promotionReceipt"]), Object{"kind": "proposal.promotionReceipt.v1"})

	for _, mode := range []struct {
		flag string
		kind string
	}{
		{"--queue-jsonl", "hq.modelCommitQueued.v1"},
		{"--receipt-jsonl", "proposal.promotionReceipt.v1"},
	} {
		status, stdout, stderr = runCLIForTest(t, "promote", "--input", proposalPath, "--confirmation", confirmationPath, mode.flag)
		rows := decodeJSONLForTest(t, stdout)
		if status != 0 || stderr != "" || len(rows) != 1 {
			t.Fatalf("%s status=%d rows=%s stderr=%q", mode.flag, status, describeForTest(objectSliceToAny(rows)), stderr)
		}
		requireFields(t, rows[0], Object{"kind": mode.kind})
	}

	for _, tc := range []struct {
		name string
		args []string
		code string
	}{
		{"bad digest", []string{"promote", "--input", proposalPath, "--confirmation", badPath, "--queue-jsonl"}, "proposal-digest-mismatch"},
		{"invalid proposal", []string{"promote", "--input", invalidPath, "--confirmation", confirmationPath, "--receipt-jsonl"}, "proposal-invalid-json"},
		{"mode conflict", []string{"promote", "--input", proposalPath, "--confirmation", confirmationPath, "--queue-jsonl", "--receipt-jsonl"}, "promotion-output-mode-conflict"},
		{"missing confirmation", []string{"promote", "--input", proposalPath, "--queue-jsonl"}, "promotion-confirmation-required"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			status, stdout, stderr := runCLIForTest(t, tc.args...)
			if status == 0 || stdout != "" || !strings.Contains(stderr, tc.code) {
				t.Fatalf("status=%d stdout=%q stderr=%q", status, stdout, stderr)
			}
		})
	}

	status, stdout, stderr = runCLIForTest(t, "promote", "--input", proposalPath, "--confirmation", badPath, "--json")
	result = decodeJSONOutputForTest(t, stdout)
	if status != 1 || stderr != "" {
		t.Fatalf("json failure status=%d stderr=%q", status, stderr)
	}
	requireFields(t, result, Object{"ok": false, "queueRow": nil})
	requireAbsent(t, result, "promotionReceipt")
	requireCodeForTest(t, result, "proposal-digest-mismatch")

	proposalAfter, _ := os.ReadFile(proposalPath)
	confirmationAfter, _ := os.ReadFile(confirmationPath)
	entriesAfter, _ := os.ReadDir(dir)
	if !bytes.Equal(proposalBefore, proposalAfter) || !bytes.Equal(confirmationBefore, confirmationAfter) || len(entriesBefore) != len(entriesAfter) {
		t.Fatal("promotion CLI mutated inputs or working directory")
	}
}
