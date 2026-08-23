package hq

import (
	"strings"
	"testing"
)

func TestLocalWorkerRequiredSerializedMeanings(t *testing.T) {
	t.Run("model agent and receipt remain distinct", func(t *testing.T) {
		result := RunLocalWorkerJSONL(rowsReaderForTest(t, validModelForContract(), validAgentForContract(), validReceiptForContract()))
		for key, want := range map[string]any{
			"ok": true, "records": 3, "processed": 1, "pending": 1, "ignored": 1, "failed": 0,
		} {
			if result[key] != want {
				t.Fatalf("%s = %#v, want %#v: %s", key, result[key], want, describeForTest(result))
			}
		}
		state := ensureObject(result["state"])
		operations := state["modelOperations"].([]any)
		tasks := state["agentTasks"].([]any)
		if len(operations) != 1 || ensureObject(operations[0])["queueId"] != "mq_001" {
			t.Fatalf("model operations: %s", describeForTest(operations))
		}
		if len(tasks) != 1 || ensureObject(tasks[0])["status"] != "pending" {
			t.Fatalf("agent tasks: %s", describeForTest(tasks))
		}
		requireDeepEqualForTest(t, ensureObject(tasks[0])["context"], []any{"repoMap.world.v1", "selectedNeighborhood"})
	})

	t.Run("malformed row becomes failed result", func(t *testing.T) {
		result := RunLocalWorkerJSONL(strings.NewReader("{not json}\n"))
		if result["ok"] != false || result["failed"] != 1 {
			t.Fatalf("worker malformed result: %s", describeForTest(result))
		}
		requireCodeForTest(t, result, "invalid-json")
	})

	t.Run("duplicate row is not processed twice", func(t *testing.T) {
		model := validModelForContract()
		agent := validAgentForContract()
		agent["id"] = model["id"]
		result := RunLocalWorkerJSONL(rowsReaderForTest(t, model, agent))
		if result["ok"] != false || result["processed"] != 1 || result["failed"] != 1 {
			t.Fatalf("duplicate worker result: %s", describeForTest(result))
		}
		state := ensureObject(result["state"])
		if len(state["modelOperations"].([]any)) != 1 || len(state["agentTasks"].([]any)) != 0 {
			t.Fatalf("duplicate altered state: %s", describeForTest(state))
		}
		requireCodeForTest(t, result, "duplicate-id")
	})

	for _, testCase := range []struct {
		name string
		row  Object
		code string
	}{
		{
			name: "authority-bearing model",
			row: func() Object {
				row := validModelForContract()
				row["payload"] = Object{"acceptedLedger": true}
				return row
			}(),
			code: "authority-field-present",
		},
		{
			name: "missing targetRef",
			row: func() Object {
				row := validModelForContract()
				delete(row, "targetRef")
				return row
			}(),
			code: "missing-required-field",
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			result := RunLocalWorkerJSONL(rowsReaderForTest(t, testCase.row))
			if result["ok"] != false || result["failed"] != 1 {
				t.Fatalf("invalid row worker result: %s", describeForTest(result))
			}
			state := ensureObject(result["state"])
			if len(state["modelOperations"].([]any)) != 0 {
				t.Fatalf("invalid model reached state: %s", describeForTest(state))
			}
			requireCodeForTest(t, result, testCase.code)
		})
	}
}

func TestAgentTaskRemainsPendingEvidenceAndNeverAdmission(t *testing.T) {
	agent := validAgentForContract()
	validation := ValidateJSONL(rowsReaderForTest(t, agent))
	if validation["ok"] != true {
		t.Fatalf("valid agent rejected: %s", describeForTest(validation))
	}

	worker := RunLocalWorkerJSONL(rowsReaderForTest(t, agent))
	if worker["ok"] != true || worker["processed"] != 0 || worker["pending"] != 1 || worker["failed"] != 0 {
		t.Fatalf("agent worker result: %s", describeForTest(worker))
	}
	state := ensureObject(worker["state"])
	if len(state["modelOperations"].([]any)) != 0 || len(state["agentTasks"].([]any)) != 1 {
		t.Fatalf("agent crossed model boundary: %s", describeForTest(state))
	}
	task := ensureObject(state["agentTasks"].([]any)[0])
	if task["kind"] != "hq.localAgentTask.v1" || task["status"] != "pending" || task["queueId"] != agent["id"] {
		t.Fatalf("pending task mismatch: %s", describeForTest(task))
	}

	withReceipts := RunLocalWorkerWithReceiptsJSONL(rowsReaderForTest(t, agent))
	if withReceipts["ok"] != true || withReceipts["receipts"] != 1 {
		t.Fatalf("agent receipt result: %s", describeForTest(withReceipts))
	}
	receipt := ensureObject(withReceipts["receiptRows"].([]any)[0])
	for key, want := range map[string]any{
		"kind": "hq.receipt.v1", "status": "pending", "queueId": agent["id"], "outputKind": "hq.localAgentTask.v1", "evidenceOnly": true,
	} {
		if receipt[key] != want {
			t.Fatalf("agent receipt %s = %#v, want %#v: %s", key, receipt[key], want, describeForTest(receipt))
		}
	}
	if _, exists := receipt["accepted"]; exists {
		t.Fatalf("agent receipt claims accepted: %s", describeForTest(receipt))
	}
	if _, exists := receipt["acceptedLedger"]; exists {
		t.Fatalf("agent receipt claims accepted ledger: %s", describeForTest(receipt))
	}

	admission := RunAdmissionGateJSONL(rowsReaderForTest(t, agent))
	if admission["ok"] != false || admission["admitted"] != 0 || admission["rejected"] != 1 || len(admission["acceptedRows"].([]any)) != 0 {
		t.Fatalf("agent admission result: %s", describeForTest(admission))
	}
	requireCodeForTest(t, admission, "not-admissible-kind")
}

func TestReceiptWriterRequiredSerializedMeanings(t *testing.T) {
	t.Run("processed and pending receipts are evidence only and self-validating", func(t *testing.T) {
		result := RunLocalWorkerWithReceiptsJSONL(rowsReaderForTest(t, validModelForContract(), validAgentForContract()))
		if result["ok"] != true || result["records"] != 2 || result["receipts"] != 2 {
			t.Fatalf("receipt result: %s", describeForTest(result))
		}
		if digest, ok := result["receiptDigest"].(string); !ok || !strings.HasPrefix(digest, "sha256:") {
			t.Fatalf("receipt digest: %#v", result["receiptDigest"])
		}
		rows := result["receiptRows"].([]any)
		modelReceipt := ensureObject(rows[0])
		agentReceipt := ensureObject(rows[1])
		for key, want := range map[string]any{
			"kind": "hq.receipt.v1", "queueId": "mq_001", "status": "processed", "evidenceOnly": true, "outputKind": "hq.localModelOperation.v1",
		} {
			if modelReceipt[key] != want {
				t.Fatalf("model receipt %s = %#v, want %#v: %s", key, modelReceipt[key], want, describeForTest(modelReceipt))
			}
		}
		for _, key := range []string{"queueDigest", "stateDigest"} {
			if text, ok := modelReceipt[key].(string); !ok || !strings.HasPrefix(text, "sha256:") {
				t.Fatalf("model receipt %s: %#v", key, modelReceipt[key])
			}
		}
		if _, exists := modelReceipt["accepted"]; exists {
			t.Fatalf("receipt claims accepted: %s", describeForTest(modelReceipt))
		}
		if _, exists := modelReceipt["authority"]; exists {
			t.Fatalf("receipt claims authority: %s", describeForTest(modelReceipt))
		}
		if agentReceipt["queueId"] != "aq_001" || agentReceipt["status"] != "pending" || agentReceipt["outputKind"] != "hq.localAgentTask.v1" {
			t.Fatalf("agent receipt: %s", describeForTest(agentReceipt))
		}

		serialized, err := RowsToJSONL(rows)
		if err != nil {
			t.Fatal(err)
		}
		validation := ValidateJSONL(strings.NewReader(string(serialized)))
		if validation["ok"] != true || validation["records"] != 2 {
			t.Fatalf("generated receipts invalid: %s", describeForTest(validation))
		}
	})

	t.Run("invalid malformed and duplicate rows still produce typed failed receipts", func(t *testing.T) {
		authority := validModelForContract()
		authority["payload"] = Object{"acceptedLedger": true}
		result := RunLocalWorkerWithReceiptsJSONL(rowsReaderForTest(t, authority))
		if result["ok"] != false || result["receipts"] != 1 {
			t.Fatalf("authority receipt result: %s", describeForTest(result))
		}
		receipt := ensureObject(result["receiptRows"].([]any)[0])
		if receipt["status"] != "failed" {
			t.Fatalf("authority receipt: %s", describeForTest(receipt))
		}
		if !containsStringForTest(errorCodesForTest(receipt["errorCodes"]), "authority-field-present") {
			found := false
			for _, value := range receipt["errorCodes"].([]any) {
				if value == "authority-field-present" {
					found = true
				}
			}
			if !found {
				t.Fatalf("authority error code missing: %s", describeForTest(receipt))
			}
		}

		malformed := RunLocalWorkerWithReceiptsJSONL(strings.NewReader("{not json}\n"))
		malformedReceipt := ensureObject(malformed["receiptRows"].([]any)[0])
		if malformed["ok"] != false || malformedReceipt["queueId"] != "line:1" || malformedReceipt["status"] != "failed" {
			t.Fatalf("malformed receipt: %s", describeForTest(malformed))
		}

		model := validModelForContract()
		agent := validAgentForContract()
		agent["id"] = model["id"]
		duplicate := RunLocalWorkerWithReceiptsJSONL(rowsReaderForTest(t, model, agent))
		duplicateRows := duplicate["receiptRows"].([]any)
		if duplicate["ok"] != false || len(duplicateRows) != 2 || ensureObject(duplicateRows[0])["status"] != "processed" || ensureObject(duplicateRows[1])["status"] != "failed" {
			t.Fatalf("duplicate receipts: %s", describeForTest(duplicate))
		}
	})
}

func TestProjectionRequiredSerializedMeanings(t *testing.T) {
	result := BuildRepoMapProjection(RunLocalWorkerWithReceiptsJSONL(rowsReaderForTest(t, validModelForContract(), validAgentForContract())))
	if result["ok"] != true {
		t.Fatalf("projection failed: %s", describeForTest(result))
	}
	projection := ensureObject(result["projection"])
	for key, want := range map[string]any{
		"kind": "repoMap.projection.v1", "generatedBy": "hq-modeling-runtime", "evidenceOnly": true, "nonAuthority": true,
	} {
		if projection[key] != want {
			t.Fatalf("projection %s = %#v, want %#v: %s", key, projection[key], want, describeForTest(projection))
		}
	}
	for _, key := range []string{"projectionDigest"} {
		if text, ok := projection[key].(string); !ok || !strings.HasPrefix(text, "sha256:") {
			t.Fatalf("projection %s: %#v", key, projection[key])
		}
	}
	source := ensureObject(projection["source"])
	for _, key := range []string{"receiptDigest", "stateDigest"} {
		if text, ok := source[key].(string); !ok || !strings.HasPrefix(text, "sha256:") {
			t.Fatalf("projection source %s: %#v", key, source[key])
		}
	}
	nodes := projection["nodes"].([]any)
	nodeIDs := []string{}
	for _, raw := range nodes {
		nodeIDs = append(nodeIDs, ensureObject(raw)["id"].(string))
	}
	requireDeepEqualForTest(t, sortedStringsForTest(nodeIDs), []string{"pkg:core", "pkg:ui"})
	edges := projection["edges"].([]any)
	if len(edges) != 1 {
		t.Fatalf("projection edges: %s", describeForTest(edges))
	}
	requireDeepEqualForTest(t, edges[0], Object{
		"id": "edge:pkg:core->pkg:ui:uses", "from": "pkg:core", "to": "pkg:ui", "type": "uses", "sourceQueueId": "mq_001", "evidenceOnly": true,
	})
	if len(projection["pendingAgentTasks"].([]any)) != 1 || len(projection["receipts"].([]any)) != 2 {
		t.Fatalf("projection pending/receipts: %s", describeForTest(projection))
	}
	for _, forbidden := range []string{"accepted", "acceptedLedger", "sourceModelAuthority"} {
		if _, exists := projection[forbidden]; exists {
			t.Fatalf("projection contains %s: %s", forbidden, describeForTest(projection))
		}
	}

	for _, testCase := range []struct {
		name string
		row  Object
		code string
	}{
		{
			name: "authority-bearing payload",
			row: func() Object {
				row := validModelForContract()
				row["payload"] = Object{"acceptedLedger": true}
				return row
			}(),
			code: "authority-field-present",
		},
		{
			name: "source-smuggled payload",
			row: func() Object {
				row := validModelForContract()
				row["payload"] = Object{"embedded": Object{"kind": "source.observation.v1", "id": "obs", "status": "observed"}}
				return row
			}(),
			code: "payload-smuggled-row",
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			invalid := BuildRepoMapProjection(RunLocalWorkerWithReceiptsJSONL(rowsReaderForTest(t, testCase.row)))
			if invalid["ok"] != false {
				t.Fatalf("invalid projection passed: %s", describeForTest(invalid))
			}
			projection := ensureObject(invalid["projection"])
			if len(projection["edges"].([]any)) != 0 {
				t.Fatalf("invalid projection created edge: %s", describeForTest(projection))
			}
			requireCodeForTest(t, Object{"errors": projection["errors"]}, testCase.code)
		})
	}
}

func TestAdmissionRequiredSerializedMeanings(t *testing.T) {
	t.Run("model becomes local-dev accepted-shaped row with evidence receipt", func(t *testing.T) {
		result := RunAdmissionGateJSONL(rowsReaderForTest(t, validModelForContract()))
		if result["ok"] != true || result["admitted"] != 1 || result["rejected"] != 0 {
			t.Fatalf("admission result: %s", describeForTest(result))
		}
		if text, ok := result["ledgerDigest"].(string); !ok || !strings.HasPrefix(text, "sha256:") {
			t.Fatalf("ledger digest: %#v", result["ledgerDigest"])
		}
		accepted := ensureObject(result["acceptedRows"].([]any)[0])
		for key, want := range map[string]any{
			"kind": "accepted.modelCommit.v1", "sourceQueueId": "mq_001", "admissionScope": "local-dev", "localDevOnly": true,
		} {
			if accepted[key] != want {
				t.Fatalf("accepted %s = %#v, want %#v: %s", key, accepted[key], want, describeForTest(accepted))
			}
		}
		for _, key := range []string{"queueDigest", "acceptedDigest"} {
			if text, ok := accepted[key].(string); !ok || !strings.HasPrefix(text, "sha256:") {
				t.Fatalf("accepted %s: %#v", key, accepted[key])
			}
		}
		for _, forbidden := range []string{"productionAuthority", "authority"} {
			if _, exists := accepted[forbidden]; exists {
				t.Fatalf("accepted row overclaims %s: %s", forbidden, describeForTest(accepted))
			}
		}
		receipt := ensureObject(result["admissionReceipts"].([]any)[0])
		if receipt["kind"] != "admission.receipt.v1" || receipt["status"] != "admitted" || receipt["queueId"] != "mq_001" || receipt["acceptedId"] != accepted["id"] || receipt["ledgerDigest"] != result["ledgerDigest"] || receipt["evidenceOnly"] != true {
			t.Fatalf("admission receipt: %s", describeForTest(receipt))
		}
	})

	for _, testCase := range []struct {
		name string
		rows []any
		code string
	}{
		{"agent task", []any{validAgentForContract()}, "not-admissible-kind"},
		{"authority-bearing payload", []any{func() Object {
			row := validModelForContract()
			row["payload"] = Object{"acceptedLedger": true}
			return row
		}()}, "authority-field-present"},
		{"source-smuggled payload", []any{func() Object {
			row := validModelForContract()
			row["payload"] = Object{"embedded": Object{"kind": "source.observation.v1"}}
			return row
		}()}, "payload-smuggled-row"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			result := RunAdmissionGateJSONL(rowsReaderForTest(t, testCase.rows...))
			if result["ok"] != false || result["admitted"] != 0 || result["rejected"] != 1 || len(result["acceptedRows"].([]any)) != 0 {
				t.Fatalf("rejection result: %s", describeForTest(result))
			}
			requireCodeForTest(t, result, testCase.code)
		})
	}

	t.Run("duplicate admits first and rejects second", func(t *testing.T) {
		first := validModelForContract()
		second := cloneObjectForTest(t, first)
		second["op"] = "addNode"
		result := RunAdmissionGateJSONL(rowsReaderForTest(t, first, second))
		if result["ok"] != false || result["admitted"] != 1 || result["rejected"] != 1 {
			t.Fatalf("duplicate admission: %s", describeForTest(result))
		}
		requireCodeForTest(t, result, "duplicate-id")
	})

	t.Run("malformed row gets line identity", func(t *testing.T) {
		result := RunAdmissionGateJSONL(strings.NewReader("{not json}\n"))
		if result["ok"] != false || result["admitted"] != 0 || result["rejected"] != 1 {
			t.Fatalf("malformed admission: %s", describeForTest(result))
		}
		requireCodeForTest(t, result, "invalid-json")
		receipt := ensureObject(result["admissionReceipts"].([]any)[0])
		if receipt["queueId"] != "line:1" {
			t.Fatalf("malformed receipt identity: %s", describeForTest(receipt))
		}
	})
}
