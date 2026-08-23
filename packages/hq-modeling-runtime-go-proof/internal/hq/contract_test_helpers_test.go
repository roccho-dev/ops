package hq

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"
)

func validModelForContract() Object {
	return Object{
		"kind":        "hq.modelCommitQueued.v1",
		"id":          "mq_001",
		"status":      "queued",
		"targetRef":   Object{"kind": "repoMap.node", "id": "pkg:core"},
		"op":          "addEdge",
		"payload":     Object{"from": "pkg:core", "to": "pkg:ui", "type": "uses"},
		"reason":      "model dependency should be visible",
		"confirmedBy": "human",
		"origin": Object{
			"kind":           "direct-human.v1",
			"confirmationId": "confirmation:mq_001",
			"confirmedBy":    "human",
		},
	}
}

func validAgentForContract() Object {
	return Object{
		"kind":        "hq.agentTaskQueued.v1",
		"id":          "aq_001",
		"status":      "queued",
		"targetRef":   Object{"kind": "repoMap.node", "id": "pkg:core"},
		"goal":        "inspect whether the dependency edge should exist",
		"context":     []any{"repoMap.world.v1", "selectedNeighborhood"},
		"acceptance":  []any{"produce modelingProposal.v1", "do not mutate accepted ledger"},
		"confirmedBy": "human",
	}
}

func validReceiptForContract() Object {
	return Object{
		"kind":        "hq.receipt.v1",
		"id":          "rc_001",
		"queueId":     "mq_001",
		"queueDigest": "sha256-queue",
		"status":      "processed",
		"message":     "processed local queue intent",
	}
}

func validProposalForContract() Object {
	return Object{
		"kind":              "modeling.proposal.v1",
		"id":                "proposal_001",
		"sourceAgentTaskId": "aq_agent_001",
		"targetRef": Object{
			"kind": "repoMap.node",
			"id":   "pkg:core",
			"coordinates": Object{
				"repo":    "ops",
				"package": "hq-modeling-runtime",
			},
			"path": []any{"packages", "hq-modeling-runtime"},
		},
		"proposedOperation": Object{
			"op": "addEdge",
			"payload": Object{
				"from":     "pkg:core",
				"to":       "pkg:ui",
				"type":     "uses",
				"metadata": Object{"reviewed": true, "risk": "bounded", "optional": nil},
				"steps":    []any{"validate", Object{"kind": "emit", "details": Object{"destination": "model-queue"}}},
			},
		},
		"evidence": []any{
			Object{"kind": "digest", "value": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
		},
		"acceptanceCriteria": []any{"human may promote into model queue only after review"},
		"status":             "proposed",
	}
}

func validConfirmationForContract(proposal any) Object {
	return Object{
		"confirm":        true,
		"confirmedBy":    "human-review",
		"proposalDigest": ProposalDigest(proposal),
	}
}

func cloneObjectForTest(t *testing.T, value Object) Object {
	t.Helper()
	cloned, ok := AsObject(CloneJSON(value))
	if !ok {
		t.Fatalf("clone is not object: %#v", value)
	}
	return cloned
}

func rowsReaderForTest(t *testing.T, rows ...any) *bytes.Reader {
	t.Helper()
	encoded, err := RowsToJSONL(rows)
	if err != nil {
		t.Fatal(err)
	}
	return bytes.NewReader(encoded)
}

func errorCodesForTest(value any) []string {
	var raw []any
	switch typed := value.(type) {
	case []any:
		raw = typed
	case Object:
		raw, _ = typed["errors"].([]any)
	case map[string]any:
		raw, _ = typed["errors"].([]any)
	case []Object:
		for _, item := range typed {
			raw = append(raw, item)
		}
	}
	codes := make([]string, 0, len(raw))
	for _, item := range raw {
		object, _ := AsObject(item)
		if code, ok := object["code"].(string); ok {
			codes = append(codes, code)
		}
	}
	return codes
}

func containsStringForTest(values []string, wanted string) bool {
	for _, value := range values {
		if value == wanted {
			return true
		}
	}
	return false
}

func requireCodeForTest(t *testing.T, value any, wanted string) {
	t.Helper()
	codes := errorCodesForTest(value)
	if !containsStringForTest(codes, wanted) {
		t.Fatalf("missing code %q in %v", wanted, codes)
	}
}

func requireAnyCodeForTest(t *testing.T, value any, wanted ...string) {
	t.Helper()
	codes := errorCodesForTest(value)
	for _, candidate := range wanted {
		if containsStringForTest(codes, candidate) {
			return
		}
	}
	t.Fatalf("missing any of %v in %v", wanted, codes)
}

func runCLIForTest(t *testing.T, args ...string) (int, string, string) {
	t.Helper()
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	status := RunCLI(args, &stdout, &stderr)
	return status, stdout.String(), stderr.String()
}

func writeJSONFileForTest(t *testing.T, dir, name string, value any) string {
	t.Helper()
	path := filepath.Join(dir, name)
	encoded, err := EncodeJSON(value, false)
	if err != nil {
		t.Fatal(err)
	}
	encoded = append(encoded, '\n')
	if err := os.WriteFile(path, encoded, 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func decodeJSONOutputForTest(t *testing.T, text string) Object {
	t.Helper()
	var value any
	decoder := json.NewDecoder(strings.NewReader(text))
	if err := decoder.Decode(&value); err != nil {
		t.Fatalf("invalid JSON output: %v\n%s", err, text)
	}
	object, ok := AsObject(value)
	if !ok {
		t.Fatalf("JSON output not object: %#v", value)
	}
	return object
}

func requireDeepEqualForTest(t *testing.T, got, want any) {
	t.Helper()
	gotJSON, gotErr := StableStringify(got)
	wantJSON, wantErr := StableStringify(want)
	if gotErr == nil && wantErr == nil {
		if gotJSON != wantJSON {
			t.Fatalf("mismatch\nwant: %s\n got: %s", wantJSON, gotJSON)
		}
		return
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("mismatch\nwant: %#v\n got: %#v", want, got)
	}
}

func sortedStringsForTest(values []string) []string {
	copyOfValues := append([]string(nil), values...)
	sort.Strings(copyOfValues)
	return copyOfValues
}

func objectAtForTest(t *testing.T, value any, path ...string) Object {
	t.Helper()
	current := value
	for _, key := range path {
		object, ok := AsObject(current)
		if !ok {
			t.Fatalf("%s is not object while reading %v: %#v", key, path, current)
		}
		current = object[key]
	}
	object, ok := AsObject(current)
	if !ok {
		t.Fatalf("value at %v is not object: %#v", path, current)
	}
	return object
}

func describeForTest(value any) string {
	text, err := StableStringify(value)
	if err != nil {
		return fmt.Sprintf("%#v", value)
	}
	return text
}
