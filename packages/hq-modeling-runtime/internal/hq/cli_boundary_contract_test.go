package hq

import (
	"strings"
	"testing"
)

func TestCLIExposesCanonicalBoundaryAndUsage(t *testing.T) {
	for _, args := range [][]string{nil, {"--json"}} {
		status, stdout, stderr := runCLIForTest(t, args...)
		if status != 0 || stderr != "" {
			t.Fatalf("boundary args=%v status=%d stdout=%q stderr=%q", args, status, stdout, stderr)
		}
		boundary := decodeJSONOutputForTest(t, stdout)
		requireFields(t, boundary, Object{
			"kind":           "hq.modelingRuntime.boundary.v1",
			"packageName":    "hq-modeling-runtime",
			"ownerRepo":      "ops",
			"implementation": "go",
			"canonical":      true,
			"nonAuthority":   true,
			"inputBoundary":  "serialized JSON and JSONL bytes",
		})
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
