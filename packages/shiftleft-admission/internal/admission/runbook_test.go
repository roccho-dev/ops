package admission

import (
	"bytes"
	"strings"
	"testing"

	packagedocs "capforge.local/ops/shiftleft-admission/docs"
)

func TestRunbookDiscoveryAndExactOutput(t *testing.T) {
	var stdout bytes.Buffer
	var stderr bytes.Buffer

	if err := RunCLI([]string{"--help"}, &stdout, &stderr); err != nil {
		t.Fatalf("--help: %v", err)
	}
	if !strings.Contains(stdout.String(), "policyctl runbook nway") {
		t.Fatalf("--help does not lead to the N-way runbook: %q", stdout.String())
	}

	stdout.Reset()
	stderr.Reset()
	if err := RunCLI([]string{"runbook", "nway"}, &stdout, &stderr); err != nil {
		t.Fatalf("runbook nway: %v", err)
	}
	if stdout.String() != packagedocs.NWayRunbook() {
		t.Fatal("CLI output differs from the package-owned Markdown")
	}
	if !strings.Contains(stdout.String(), "| Owner package | `shiftleft-admission` |") {
		t.Fatal("runbook does not declare its owner package")
	}
}
