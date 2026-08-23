package hq

import (
	"fmt"
)

func validateModelingProposal(value any, line int) (Object, []Object) {
	record, ok := AsObject(value)
	if !ok {
		return nil, []Object{Error("proposal-not-object", "proposal must be a plain non-Proxy object", Object{"line": line})}
	}
	errors := []Object{}
	if findings := serializedDataFindings(record); len(findings) > 0 {
		addSerializedDataErrors(&errors, findings, line, true)
		return record, errors
	}
	addAuthorityShapeErrors(&errors, record, line, true)
	if record["kind"] != "modeling.proposal.v1" {
		errors = append(errors, Error("invalid-proposal-kind", "proposal kind must be modeling.proposal.v1, got "+JSString(valueFrom(record, "kind")), Object{"line": line, "kind": valueFrom(record, "kind")}))
		return record, errors
	}
	for _, field := range []string{"id", "sourceAgentTaskId", "targetRef", "proposedOperation", "evidence", "acceptanceCriteria", "status"} {
		if _, exists := record[field]; !exists {
			errors = append(errors, Error("missing-required-field", "missing required field: "+field, Object{"line": line, "field": field}))
		}
	}
	if _, ok := NonEmptyString(record["id"]); !ok {
		errors = append(errors, Error("invalid-id", "id must be a non-empty string", Object{"line": line}))
	}
	if _, ok := NonEmptyString(record["sourceAgentTaskId"]); !ok {
		errors = append(errors, Error("invalid-sourceAgentTaskId", "sourceAgentTaskId must be a non-empty string", Object{"line": line, "id": valueFrom(record, "id")}))
	}
	if target, ok := AsObject(record["targetRef"]); !ok {
		errors = append(errors, Error("targetRef-not-object", "targetRef must be an object", Object{"line": line, "id": valueFrom(record, "id")}))
	} else {
		if _, ok := NonEmptyString(target["kind"]); !ok {
			errors = append(errors, Error("targetRef-missing-kind", "targetRef.kind must be a non-empty string", Object{"line": line, "id": valueFrom(record, "id")}))
		}
		if _, ok := NonEmptyString(target["id"]); !ok {
			errors = append(errors, Error("targetRef-missing-id", "targetRef.id must be a non-empty string", Object{"line": line, "id": valueFrom(record, "id")}))
		}
	}
	if operation, ok := AsObject(record["proposedOperation"]); !ok {
		errors = append(errors, Error("proposedOperation-not-object", "proposedOperation must be an object", Object{"line": line, "id": valueFrom(record, "id")}))
	} else {
		if _, ok := NonEmptyString(operation["op"]); !ok {
			errors = append(errors, Error("proposal-op-missing", "proposedOperation.op must be a non-empty string", Object{"line": line, "id": valueFrom(record, "id")}))
		}
		if _, ok := AsObject(operation["payload"]); !ok {
			errors = append(errors, Error("proposal-payload-not-object", "proposedOperation.payload must be an object", Object{"line": line, "id": valueFrom(record, "id")}))
		}
	}
	if evidence, ok := AsArray(record["evidence"]); !ok || len(evidence) == 0 {
		errors = append(errors, Error("evidence-missing", "evidence must be a non-empty array", Object{"line": line, "id": valueFrom(record, "id")}))
	}
	if acceptance, ok := AsArray(record["acceptanceCriteria"]); !ok || len(acceptance) == 0 {
		errors = append(errors, Error("acceptanceCriteria-missing", "acceptanceCriteria must be a non-empty array", Object{"line": line, "id": valueFrom(record, "id")}))
	}
	status, _ := record["status"].(string)
	if status != "proposed" && status != "rejected" && status != "promoted" {
		errors = append(errors, Error("invalid-proposal-status", "status must be proposed, rejected, or promoted", Object{"line": line, "id": valueFrom(record, "id"), "status": valueFrom(record, "status")}))
	}
	return record, errors
}

func ProposalDigest(value any) string {
	return SHA256Digest(value)
}

func PromoteProposalToModelQueue(proposalValue, confirmationValue any) Object {
	proposal, proposalErrors := validateModelingProposal(proposalValue, 1)
	if len(proposalErrors) > 0 {
		return Object{"ok": false, "errors": objectSliceToAny(proposalErrors), "queueRow": nil}
	}
	digest := ProposalDigest(proposal)
	errors := []Object{}
	confirmationInput, ok := AsObject(confirmationValue)
	var confirmation Object
	if !ok {
		errors = append(errors, Error("confirmation-missing", "plain human confirmation object is required"))
	} else {
		confirmation = Object{}
		for _, contract := range []struct {
			field        string
			expectedType string
		}{
			{field: "confirm", expectedType: "boolean"},
			{field: "confirmedBy", expectedType: "string"},
			{field: "proposalDigest", expectedType: "string"},
		} {
			value, exists := confirmationInput[contract.field]
			if !exists {
				errors = append(errors, Error("confirmation-field-not-own", "confirmation."+contract.field+" must be an own property", Object{"field": contract.field}))
				continue
			}
			validType := (contract.expectedType == "boolean" && JSTypeof(value) == "boolean") ||
				(contract.expectedType == "string" && JSTypeof(value) == "string")
			if !validType {
				errors = append(errors, Error("confirmation-field-type-invalid", "confirmation."+contract.field+" must be a primitive "+contract.expectedType, Object{
					"field": contract.field, "expectedType": contract.expectedType, "actualType": JSTypeof(value),
				}))
				continue
			}
			confirmation[contract.field] = value
		}
		if confirmation["confirm"] != true {
			errors = append(errors, Error("confirmation-not-true", "confirmation.confirm must be true"))
		}
		if _, ok := NonEmptyString(confirmation["confirmedBy"]); !ok {
			errors = append(errors, Error("confirmedBy-missing", "confirmation.confirmedBy must be a non-empty string"))
		}
		if confirmation["proposalDigest"] != digest {
			errors = append(errors, Error("proposal-digest-mismatch", "confirmation.proposalDigest must match proposal digest"))
		}
	}
	if proposal["status"] != "proposed" {
		errors = append(errors, Error("proposal-not-promotable", "only status=proposed can be promoted", Object{"status": proposal["status"]}))
	}
	if len(errors) > 0 {
		return Object{"ok": false, "errors": objectSliceToAny(errors), "queueRow": nil}
	}

	operation := ensureObject(proposal["proposedOperation"])
	confirmedBy, _ := confirmation["confirmedBy"].(string)
	queueRow := Object{
		"kind":           "hq.modelCommitQueued.v1",
		"id":             "mq_from_" + fmt.Sprint(proposal["id"]),
		"status":         "queued",
		"targetRef":      proposal["targetRef"],
		"op":             operation["op"],
		"payload":        operation["payload"],
		"evidence":       proposal["evidence"],
		"reason":         "promoted proposal " + fmt.Sprint(proposal["id"]),
		"confirmedBy":    confirmedBy,
		"proposalDigest": digest,
	}
	confirmationDigest := SHA256Digest(Object{
		"kind": "proposal.promotionConfirmation.v1", "confirm": confirmation["confirm"], "confirmedBy": confirmedBy, "proposalDigest": confirmation["proposalDigest"],
	})
	origin := BuildProposalPromotionOrigin(queueRow, fmt.Sprint(proposal["id"]), digest, confirmationDigest, confirmedBy)
	queueRow["origin"] = origin
	queueErrors := ValidateProposalPromotionRecord(queueRow, 1, origin)
	if len(queueErrors) > 0 {
		return Object{"ok": false, "errors": objectSliceToAny(queueErrors), "queueRow": nil}
	}
	receipt := Object{
		"kind":                 "proposal.promotionReceipt.v1",
		"id":                   origin["promotionEvidenceId"],
		"proposalId":           proposal["id"],
		"proposalDigest":       digest,
		"queueId":              queueRow["id"],
		"queueIntegrityDigest": origin["integrityDigest"],
		"confirmationDigest":   origin["confirmationDigest"],
		"confirmedBy":          confirmedBy,
		"evidenceDigest":       origin["evidenceDigest"],
		"promotionEvidenceId":  origin["promotionEvidenceId"],
		"evidenceOnly":         true,
		"nonAuthority":         true,
	}
	return Object{"ok": true, "errors": []any{}, "queueRow": queueRow, "promotionReceipt": receipt}
}
