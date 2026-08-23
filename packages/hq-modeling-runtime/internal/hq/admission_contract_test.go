package hq

import (
	"strings"
	"testing"
)

func TestAdmissionAcceptsOnlyModelCommitIntent(t *testing.T) {
	result := RunAdmissionGateJSONL(rowsReaderForTest(t, validModelForContract()))
	requireResult(t, result, Object{"ok": true, "admitted": 1, "rejected": 0})
	requireSHA(t, result["ledgerDigest"])
	accepted := ensureObject(result["acceptedRows"].([]any)[0])
	requireFields(t, accepted, Object{"kind": "accepted.modelCommit.v1", "sourceQueueId": "mq_001", "admissionScope": "local-dev", "localDevOnly": true})
	requireSHA(t, accepted["queueDigest"])
	requireSHA(t, accepted["acceptedDigest"])
	requireAbsent(t, accepted, "productionAuthority", "authority")
	receipt := ensureObject(result["admissionReceipts"].([]any)[0])
	requireFields(t, receipt, Object{"kind": "admission.receipt.v1", "status": "admitted", "queueId": "mq_001", "acceptedId": accepted["id"], "ledgerDigest": result["ledgerDigest"], "evidenceOnly": true})

	for _, tc := range []struct {
		name string
		rows []any
		code string
	}{
		{"agent", []any{validAgentForContract()}, "not-admissible-kind"},
		{"authority", []any{func() Object { r := validModelForContract(); r["payload"] = Object{"acceptedLedger": true}; return r }()}, "authority-field-present"},
		{"source", []any{func() Object {
			r := validModelForContract()
			r["payload"] = Object{"embedded": Object{"kind": "source.observation.v1"}}
			return r
		}()}, "payload-smuggled-row"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := RunAdmissionGateJSONL(rowsReaderForTest(t, tc.rows...))
			requireResult(t, r, Object{"ok": false, "admitted": 0, "rejected": 1}, tc.code)
			if len(r["acceptedRows"].([]any)) != 0 {
				t.Fatal(describeForTest(r))
			}
		})
	}

	first, second := validModelForContract(), validModelForContract()
	second["op"] = "addNode"
	duplicate := RunAdmissionGateJSONL(rowsReaderForTest(t, first, second))
	requireResult(t, duplicate, Object{"ok": false, "admitted": 1, "rejected": 1}, "duplicate-id")
	malformed := RunAdmissionGateJSONL(strings.NewReader("{not json}\n"))
	requireResult(t, malformed, Object{"ok": false, "admitted": 0, "rejected": 1}, "invalid-json")
	requireFields(t, ensureObject(malformed["admissionReceipts"].([]any)[0]), Object{"queueId": "line:1"})
}
