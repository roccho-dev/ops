package hq

import (
	"fmt"
	"io"
)

func safeQueueID(record any, line int) string {
	object, _ := AsObject(record)
	if id, ok := NonEmptyString(valueFrom(object, "id")); ok {
		return id
	}
	return fmt.Sprintf("line:%d", line)
}

func acceptedModelCommit(record Object, line int) Object {
	base := Object{
		"kind":           "accepted.modelCommit.v1",
		"id":             "accepted:" + fmt.Sprint(record["id"]),
		"sourceQueueId":  record["id"],
		"admissionScope": "local-dev",
		"localDevOnly":   true,
		"targetRef":      record["targetRef"],
		"op":             record["op"],
		"payload":        record["payload"],
		"confirmedBy":    record["confirmedBy"],
		"line":           line,
		"queueDigest":    SHA256Digest(record),
	}
	row := CloneJSON(base).(map[string]any)
	row["acceptedDigest"] = SHA256Digest(base)
	if reason, exists := record["reason"]; exists {
		row["reason"] = reason
	}
	return row
}

func admissionReceipt(record any, line int, status string, acceptedRow Object, errors []Object, ledgerDigest any) Object {
	queueID := safeQueueID(record, line)
	var digestMaterial any = record
	if record == nil {
		digestMaterial = Object{"line": line, "errors": objectSliceToAny(errors)}
	}
	message := "queue row rejected by local-dev admission gate"
	if status == "admitted" {
		message = "model commit admitted into local-dev accepted-ledger-shaped output"
	}
	receipt := Object{
		"kind":           "admission.receipt.v1",
		"id":             fmt.Sprintf("admission-receipt:%s:%d", queueID, line),
		"queueId":        queueID,
		"line":           line,
		"status":         status,
		"admissionScope": "local-dev",
		"localDevOnly":   true,
		"evidenceOnly":   true,
		"queueDigest":    SHA256Digest(digestMaterial),
		"ledgerDigest":   ledgerDigest,
		"message":        message,
	}
	if object, ok := AsObject(record); ok {
		kind := valueFrom(object, "kind")
		if JSTruthy(kind) {
			receipt["queueKind"] = kind
		}
	}
	if acceptedRow != nil {
		receipt["acceptedId"] = acceptedRow["id"]
	}
	if len(errors) > 0 {
		receipt["errorCodes"] = errorCodes(errors)
	}
	return receipt
}

func RunAdmissionGateJSONL(reader io.Reader) Object {
	acceptedRows := []any{}
	receipts := []any{}
	errors := []any{}
	seen := map[string]int{}
	records := 0
	_ = VisitJSONLLines(reader, func(line int, trimmed []byte) {
		records++
		value, parseError := ParseJSONLine(trimmed, line)
		if parseError != nil {
			receipts = append(receipts, admissionReceipt(nil, line, "rejected", nil, []Object{parseError}, nil))
			errors = append(errors, parseError)
			return
		}
		record, validationErrors := ValidateRecord(value, line)
		if len(validationErrors) > 0 {
			receipts = append(receipts, admissionReceipt(value, line, "rejected", nil, validationErrors, nil))
			for _, validationError := range validationErrors {
				errors = append(errors, validationError)
			}
			return
		}
		id, _ := NonEmptyString(record["id"])
		if first, exists := seen[id]; exists {
			duplicate := Error("duplicate-id", "duplicate id: "+id, Object{"id": id, "line": line, "firstLine": first})
			receipts = append(receipts, admissionReceipt(record, line, "rejected", nil, []Object{duplicate}, nil))
			errors = append(errors, duplicate)
			return
		}
		seen[id] = line
		if record["kind"] != "hq.modelCommitQueued.v1" {
			errorRow := Error("not-admissible-kind", "only hq.modelCommitQueued.v1 is admissible, got "+JSString(valueFrom(record, "kind")), Object{"kind": valueFrom(record, "kind"), "line": line})
			receipts = append(receipts, admissionReceipt(record, line, "rejected", nil, []Object{errorRow}, nil))
			errors = append(errors, errorRow)
			return
		}
		accepted := acceptedModelCommit(record, line)
		acceptedRows = append(acceptedRows, accepted)
		receipts = append(receipts, admissionReceipt(record, line, "admitted", accepted, nil, nil))
	})
	ledgerDigest := SHA256Digest(acceptedRows)
	withLedger := make([]any, 0, len(receipts))
	for _, value := range receipts {
		receipt := CloneJSON(value).(map[string]any)
		receipt["ledgerDigest"] = ledgerDigest
		withLedger = append(withLedger, receipt)
	}
	rejected := 0
	for _, value := range withLedger {
		if ensureObject(value)["status"] == "rejected" {
			rejected++
		}
	}
	return Object{
		"ok": len(errors) == 0, "records": records, "admitted": len(acceptedRows), "rejected": rejected,
		"acceptedRows": acceptedRows, "admissionReceipts": withLedger, "ledgerDigest": ledgerDigest, "errors": errors,
	}
}
