package hq

import (
	"strings"
	"testing"
)

func TestWorkerPreservesQueueIntentBoundaries(t *testing.T) {
	result := RunLocalWorkerJSONL(rowsReaderForTest(t, validModelForContract(), validAgentForContract(), validReceiptForContract()))
	requireResult(t, result, Object{"ok": true, "records": 3, "processed": 1, "pending": 1, "ignored": 1, "failed": 0})
	state := ensureObject(result["state"])
	ops, tasks := state["modelOperations"].([]any), state["agentTasks"].([]any)
	if len(ops) != 1 || ensureObject(ops[0])["queueId"] != "mq_001" || len(tasks) != 1 || ensureObject(tasks[0])["status"] != "pending" {
		t.Fatal(describeForTest(state))
	}
	requireDeepEqualForTest(t, ensureObject(tasks[0])["context"], []any{"repoMap.world.v1", "selectedNeighborhood"})

	bad := []struct {
		name string
		in   string
		code string
	}{
		{"malformed", "{not json}\n", "invalid-json"},
	}
	for _, tc := range bad {
		t.Run(tc.name, func(t *testing.T) {
			r := RunLocalWorkerJSONL(strings.NewReader(tc.in))
			requireResult(t, r, Object{"ok": false, "failed": 1}, tc.code)
		})
	}

	model, agent := validModelForContract(), validAgentForContract()
	agent["id"] = model["id"]
	duplicate := RunLocalWorkerJSONL(rowsReaderForTest(t, model, agent))
	requireResult(t, duplicate, Object{"ok": false, "processed": 1, "failed": 1}, "duplicate-id")
	state = ensureObject(duplicate["state"])
	if len(state["modelOperations"].([]any)) != 1 || len(state["agentTasks"].([]any)) != 0 {
		t.Fatal(describeForTest(state))
	}

	for _, tc := range []struct {
		name string
		row  Object
		code string
	}{
		{"authority", func() Object { r := validModelForContract(); r["payload"] = Object{"acceptedLedger": true}; return r }(), "authority-field-present"},
		{"missing target", func() Object { r := validModelForContract(); delete(r, "targetRef"); return r }(), "missing-required-field"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := RunLocalWorkerJSONL(rowsReaderForTest(t, tc.row))
			requireResult(t, r, Object{"ok": false, "failed": 1}, tc.code)
			if len(ensureObject(r["state"])["modelOperations"].([]any)) != 0 {
				t.Fatal(describeForTest(r))
			}
		})
	}
}
