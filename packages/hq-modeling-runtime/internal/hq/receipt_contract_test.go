package hq

import (
	"strings"
	"testing"
)

func TestReceiptsAreDeterministicEvidence(t *testing.T) {
	result := RunLocalWorkerWithReceiptsJSONL(rowsReaderForTest(t, validModelForContract(), validAgentForContract()))
	requireResult(t, result, Object{"ok": true, "records": 2, "receipts": 2})
	requireSHA(t, result["receiptDigest"])
	rows := result["receiptRows"].([]any)
	model, agent := ensureObject(rows[0]), ensureObject(rows[1])
	requireFields(t, model, Object{"kind": "hq.receipt.v1", "queueId": "mq_001", "status": "processed", "evidenceOnly": true, "outputKind": "hq.localModelOperation.v1"})
	requireSHA(t, model["queueDigest"])
	requireSHA(t, model["stateDigest"])
	requireAbsent(t, model, "accepted", "authority")
	requireFields(t, agent, Object{"queueId": "aq_001", "status": "pending", "outputKind": "hq.localAgentTask.v1"})
	encoded, err := RowsToJSONL(rows)
	if err != nil {
		t.Fatal(err)
	}
	requireResult(t, ValidateJSONL(strings.NewReader(string(encoded))), Object{"ok": true, "records": 2})

	authority := validModelForContract()
	authority["payload"] = Object{"acceptedLedger": true}
	failed := RunLocalWorkerWithReceiptsJSONL(rowsReaderForTest(t, authority))
	requireResult(t, failed, Object{"ok": false, "receipts": 1})
	fr := ensureObject(failed["receiptRows"].([]any)[0])
	requireFields(t, fr, Object{"status": "failed"})
	found := false
	for _, code := range fr["errorCodes"].([]any) {
		found = found || code == "authority-field-present"
	}
	if !found {
		t.Fatal(describeForTest(fr))
	}

	malformed := RunLocalWorkerWithReceiptsJSONL(strings.NewReader("{not json}\n"))
	mr := ensureObject(malformed["receiptRows"].([]any)[0])
	requireFields(t, mr, Object{"queueId": "line:1", "status": "failed"})
	m, a := validModelForContract(), validAgentForContract()
	a["id"] = m["id"]
	duplicate := RunLocalWorkerWithReceiptsJSONL(rowsReaderForTest(t, m, a))
	dr := duplicate["receiptRows"].([]any)
	if duplicate["ok"] != false || len(dr) != 2 || ensureObject(dr[0])["status"] != "processed" || ensureObject(dr[1])["status"] != "failed" {
		t.Fatal(describeForTest(duplicate))
	}
}
