package hq

import (
	"testing"
)

func TestAgentTasksRemainPendingAndNonAuthoritative(t *testing.T) {
	agent := validAgentForContract()
	requireFields(t, ValidateJSONL(rowsReaderForTest(t, agent)), Object{"ok": true})
	worker := RunLocalWorkerJSONL(rowsReaderForTest(t, agent))
	requireResult(t, worker, Object{"ok": true, "processed": 0, "pending": 1, "failed": 0})
	state := ensureObject(worker["state"])
	if len(state["modelOperations"].([]any)) != 0 || len(state["agentTasks"].([]any)) != 1 {
		t.Fatal(describeForTest(state))
	}
	task := ensureObject(state["agentTasks"].([]any)[0])
	requireFields(t, task, Object{"kind": "hq.localAgentTask.v1", "status": "pending", "queueId": agent["id"]})

	withReceipts := RunLocalWorkerWithReceiptsJSONL(rowsReaderForTest(t, agent))
	requireResult(t, withReceipts, Object{"ok": true, "receipts": 1})
	receipt := ensureObject(withReceipts["receiptRows"].([]any)[0])
	requireFields(t, receipt, Object{"kind": "hq.receipt.v1", "status": "pending", "queueId": agent["id"], "outputKind": "hq.localAgentTask.v1", "evidenceOnly": true})
	requireAbsent(t, receipt, "accepted", "acceptedLedger")

	admission := RunAdmissionGateJSONL(rowsReaderForTest(t, agent))
	requireResult(t, admission, Object{"ok": false, "admitted": 0, "rejected": 1}, "not-admissible-kind")
	if len(admission["acceptedRows"].([]any)) != 0 {
		t.Fatal(describeForTest(admission))
	}
}
