package hq

import (
	"fmt"
	"io"
	"sort"
)

func InitialWorkerState() Object {
	return Object{
		"kind":            "hq.localWorkerState.v1",
		"modelOperations": []any{},
		"agentTasks":      []any{},
	}
}

func failedResult(line int, id any, kind any, errors []Object) Object {
	return Object{
		"line":       line,
		"id":         id,
		"kind":       kind,
		"status":     "failed",
		"errorCodes": errorCodes(errors),
		"errors":     objectSliceToAny(errors),
	}
}

func ProcessRecord(value any, state Object, line int) Object {
	record, errors := ValidateRecord(value, line)
	if len(errors) > 0 {
		var id any
		var kind any
		if record != nil {
			id = record["id"]
			kind = record["kind"]
		}
		return failedResult(line, id, kind, errors)
	}

	switch record["kind"] {
	case "hq.modelCommitQueued.v1":
		reason := any(nil)
		if value, exists := record["reason"]; exists {
			reason = value
		}
		operation := Object{
			"kind":        "hq.localModelOperation.v1",
			"queueId":     record["id"],
			"targetRef":   record["targetRef"],
			"op":          record["op"],
			"payload":     record["payload"],
			"reason":      reason,
			"confirmedBy": record["confirmedBy"],
			"status":      "shadow-applied",
		}
		state["modelOperations"] = append(state["modelOperations"].([]any), operation)
		return Object{"line": line, "id": record["id"], "kind": record["kind"], "status": "processed", "outputKind": operation["kind"]}
	case "hq.agentTaskQueued.v1":
		context := any([]any{})
		if value, exists := record["context"]; exists {
			context = value
		}
		acceptance := any([]any{})
		if value, exists := record["acceptance"]; exists {
			acceptance = value
		}
		task := Object{
			"kind":        "hq.localAgentTask.v1",
			"queueId":     record["id"],
			"targetRef":   record["targetRef"],
			"goal":        record["goal"],
			"context":     context,
			"acceptance":  acceptance,
			"confirmedBy": record["confirmedBy"],
			"status":      "pending",
		}
		state["agentTasks"] = append(state["agentTasks"].([]any), task)
		return Object{"line": line, "id": record["id"], "kind": record["kind"], "status": "pending", "outputKind": task["kind"]}
	case "hq.receipt.v1":
		return Object{
			"line": line, "id": record["id"], "kind": record["kind"], "status": "ignored",
			"reason": "receipt rows are evidence-only and are not worker input",
		}
	default:
		return failedResult(line, record["id"], record["kind"], []Object{
			Error("unsupported-worker-kind", "unsupported worker kind: "+fmt.Sprint(record["kind"]), Object{"line": line}),
		})
	}
}

func RunLocalWorkerJSONL(reader io.Reader) Object {
	state := InitialWorkerState()
	results := []any{}
	errors := []any{}
	seen := map[string]int{}
	records := 0
	_ = VisitJSONLLines(reader, func(line int, trimmed []byte) {
		records++
		value, parseError := ParseJSONLine(trimmed, line)
		if parseError != nil {
			errors = append(errors, parseError)
			results = append(results, failedResult(line, nil, nil, []Object{parseError}))
			return
		}
		if record, ok := AsObject(value); ok {
			if id, ok := NonEmptyString(record["id"]); ok {
				if first, exists := seen[id]; exists {
					duplicate := Error("duplicate-id", "duplicate id: "+id, Object{"id": id, "line": line, "firstLine": first})
					errors = append(errors, duplicate)
					results = append(results, failedResult(line, id, record["kind"], []Object{duplicate}))
					return
				}
				seen[id] = line
			}
		}
		result := ProcessRecord(value, state, line)
		results = append(results, result)
		if result["status"] == "failed" {
			if rowErrors, ok := result["errors"].([]any); ok {
				errors = append(errors, rowErrors...)
			}
		}
	})

	count := func(status string) int {
		total := 0
		for _, item := range results {
			if ensureObject(item)["status"] == status {
				total++
			}
		}
		return total
	}
	return Object{
		"ok": len(errors) == 0, "records": records,
		"processed": count("processed"), "pending": count("pending"), "ignored": count("ignored"), "failed": count("failed"),
		"state": state, "results": results, "errors": errors,
	}
}

func receiptStatus(workerStatus any) string {
	switch workerStatus {
	case "processed", "ignored":
		return "processed"
	case "pending":
		return "pending"
	default:
		return "failed"
	}
}

func receiptMessage(result Object) string {
	switch result["status"] {
	case "processed":
		return "local worker processed model queue intent"
	case "pending":
		return "local worker recorded pending agent task intent"
	case "ignored":
		if reason, ok := result["reason"].(string); ok {
			return reason
		}
		return "local worker ignored evidence-only row"
	default:
		codes := []string{}
		if values, ok := result["errorCodes"].([]any); ok {
			for _, value := range values {
				codes = append(codes, fmt.Sprint(value))
			}
		}
		return "local worker failed: " + joinStrings(codes, ",")
	}
}

func joinStrings(values []string, separator string) string {
	result := ""
	for index, value := range values {
		if index > 0 {
			result += separator
		}
		result += value
	}
	return result
}

func ReceiptsFromWorkerResult(worker Object) []any {
	stateDigest := SHA256Digest(worker["state"])
	results, _ := worker["results"].([]any)
	receipts := make([]any, 0, len(results))
	for _, value := range results {
		result := ensureObject(value)
		queueID, ok := NonEmptyString(result["id"])
		if !ok {
			queueID = fmt.Sprintf("line:%v", result["line"])
		}
		outputKind := any(nil)
		if value, exists := result["outputKind"]; exists {
			outputKind = value
		}
		receipt := Object{
			"kind":         "hq.receipt.v1",
			"id":           fmt.Sprintf("receipt:%s:%v", queueID, result["line"]),
			"queueId":      queueID,
			"status":       receiptStatus(result["status"]),
			"line":         result["line"],
			"workerStatus": result["status"],
			"evidenceOnly": true,
			"queueDigest": SHA256Digest(Object{
				"line": result["line"], "queueId": queueID, "kind": result["kind"], "status": result["status"], "outputKind": outputKind,
			}),
			"stateDigest": stateDigest,
			"outputKind":  outputKind,
			"message":     receiptMessage(result),
		}
		if result["kind"] != nil {
			receipt["queueKind"] = result["kind"]
		}
		if codes, ok := result["errorCodes"].([]any); ok && len(codes) > 0 {
			receipt["errorCodes"] = codes
		}
		receipts = append(receipts, receipt)
	}
	return receipts
}

func RunLocalWorkerWithReceiptsJSONL(reader io.Reader) Object {
	worker := RunLocalWorkerJSONL(reader)
	receipts := ReceiptsFromWorkerResult(worker)
	return Object{
		"ok": worker["ok"], "records": worker["records"], "receipts": len(receipts),
		"worker": worker, "receiptRows": receipts, "receiptDigest": SHA256Digest(receipts),
	}
}

func BuildRepoMapProjection(workerReceipt Object) Object {
	nodes := map[string]Object{}
	edges := []Object{}
	worker := ensureObject(workerReceipt["worker"])
	state := ensureObject(worker["state"])
	operations, _ := state["modelOperations"].([]any)
	ensureNode := func(id, kind string) {
		if _, exists := nodes[id]; !exists {
			nodes[id] = Object{"id": id, "kind": kind, "label": id, "evidenceOnly": true}
		}
	}
	for _, value := range operations {
		operation := ensureObject(value)
		if target, ok := AsObject(operation["targetRef"]); ok {
			if id, ok := NonEmptyString(target["id"]); ok {
				kind, ok := NonEmptyString(target["kind"])
				if !ok {
					kind = "target"
				}
				ensureNode(id, kind)
			}
		}
		if operation["op"] != "addEdge" {
			continue
		}
		payload, ok := AsObject(operation["payload"])
		if !ok {
			continue
		}
		from, fromOK := payload["from"].(string)
		to, toOK := payload["to"].(string)
		if !fromOK || !toOK {
			continue
		}
		typeValue, ok := payload["type"].(string)
		if !ok {
			typeValue = "related"
		}
		edge := Object{
			"id": fmt.Sprintf("edge:%s->%s:%s", from, to, typeValue), "from": from, "to": to, "type": typeValue,
			"sourceQueueId": operation["queueId"], "evidenceOnly": true,
		}
		ensureNode(from, "package")
		ensureNode(to, "package")
		edges = append(edges, edge)
	}
	nodeIDs := make([]string, 0, len(nodes))
	for id := range nodes {
		nodeIDs = append(nodeIDs, id)
	}
	sort.Strings(nodeIDs)
	nodeRows := make([]any, 0, len(nodeIDs))
	for _, id := range nodeIDs {
		nodeRows = append(nodeRows, nodes[id])
	}
	sort.Slice(edges, func(i, j int) bool { return edges[i]["id"].(string) < edges[j]["id"].(string) })
	edgeRows := make([]any, len(edges))
	for index, edge := range edges {
		edgeRows[index] = edge
	}

	pending := []any{}
	for _, value := range state["agentTasks"].([]any) {
		task := ensureObject(value)
		pending = append(pending, Object{
			"queueId": task["queueId"], "targetRef": task["targetRef"], "goal": task["goal"], "status": task["status"], "evidenceOnly": true,
		})
	}
	receipts := []any{}
	for _, value := range workerReceipt["receiptRows"].([]any) {
		receipt := ensureObject(value)
		receipts = append(receipts, Object{"id": receipt["id"], "queueId": receipt["queueId"], "status": receipt["status"], "queueDigest": receipt["queueDigest"]})
	}
	projection := Object{
		"kind": "repoMap.projection.v1", "projectionId": "repoMap.localShadow.v1", "generatedBy": "hq-modeling-runtime",
		"evidenceOnly": true, "nonAuthority": true,
		"source": Object{"records": workerReceipt["records"], "receiptDigest": workerReceipt["receiptDigest"], "stateDigest": SHA256Digest(state)},
		"nodes":  nodeRows, "edges": edgeRows, "pendingAgentTasks": pending, "receipts": receipts, "errors": worker["errors"],
	}
	withDigest := CloneJSON(projection).(map[string]any)
	withDigest["projectionDigest"] = SHA256Digest(projection)
	return Object{"ok": workerReceipt["ok"], "projection": withDigest}
}
