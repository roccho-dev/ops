package hq

import (
	"fmt"
	"strings"
)

func validateModelQueueOrigin(record Object, errors *[]Object, line int) {
	origin, ok := AsObject(record["origin"])
	if !ok {
		*errors = append(*errors, Error("model-origin-not-object", "model queue origin must be a plain object", Object{"line": line, "id": valueFrom(record, "id")}))
		return
	}
	kind, _ := origin["kind"].(string)
	if kind != "direct-human.v1" && kind != "proposal-promotion.v1" {
		*errors = append(*errors, Error("invalid-model-origin-kind", "model queue origin.kind must be one of: direct-human.v1, proposal-promotion.v1", Object{"line": line, "id": valueFrom(record, "id"), "originKind": valueFrom(origin, "kind")}))
		return
	}
	if kind == "direct-human.v1" {
		for _, field := range []string{"confirmationId", "confirmedBy"} {
			if _, ok := NonEmptyString(origin[field]); !ok {
				*errors = append(*errors, Error("direct-human-origin-field-invalid", "direct-human origin."+field+" must be a non-empty own data field", Object{"line": line, "id": valueFrom(record, "id"), "field": field}))
			}
		}
		if confirmedBy, ok := NonEmptyString(origin["confirmedBy"]); ok && confirmedBy != record["confirmedBy"] {
			*errors = append(*errors, Error("origin-confirmedBy-mismatch", "origin.confirmedBy must match row.confirmedBy", Object{"line": line, "id": valueFrom(record, "id")}))
		}
		return
	}

	for _, field := range proposalOriginFields[1:] {
		if _, ok := NonEmptyString(origin[field]); !ok {
			*errors = append(*errors, Error("proposal-origin-field-invalid", "proposal promotion origin."+field+" must be a non-empty own data field", Object{"line": line, "id": valueFrom(record, "id"), "field": field}))
		}
	}
	for _, pair := range [][2]string{
		{"proposalDigest", "proposal-origin-digest-invalid"},
		{"confirmationDigest", "proposal-origin-confirmation-digest-invalid"},
		{"evidenceDigest", "proposal-origin-evidence-digest-invalid"},
		{"promotionEvidenceId", "promotion-evidence-id-invalid"},
		{"integrityDigest", "promotion-integrity-digest-invalid"},
	} {
		if _, ok := NonEmptyString(origin[pair[0]]); ok && !isCanonicalDigest(origin[pair[0]]) {
			*errors = append(*errors, Error(pair[1], "origin."+pair[0]+" must be a canonical sha256 digest", Object{"line": line, "id": valueFrom(record, "id")}))
		}
	}

	if digest, exists := record["proposalDigest"]; !exists || digest != origin["proposalDigest"] {
		*errors = append(*errors, Error("proposal-origin-digest-mismatch", "row.proposalDigest must match origin.proposalDigest", Object{"line": line, "id": valueFrom(record, "id")}))
	}
	if origin["confirmedBy"] != record["confirmedBy"] {
		*errors = append(*errors, Error("origin-confirmedBy-mismatch", "origin.confirmedBy must match row.confirmedBy", Object{"line": line, "id": valueFrom(record, "id")}))
	}
	if proposalID, ok := NonEmptyString(origin["proposalId"]); ok {
		if record["id"] != "mq_from_"+proposalID {
			*errors = append(*errors, Error("proposal-origin-queue-id-mismatch", "proposal-origin queue id must link to origin.proposalId", Object{"line": line, "id": valueFrom(record, "id")}))
		}
		if record["reason"] != "promoted proposal "+proposalID {
			*errors = append(*errors, Error("proposal-origin-reason-mismatch", "proposal-origin reason must link to origin.proposalId", Object{"line": line, "id": valueFrom(record, "id")}))
		}
	}

	evidence, evidenceOK := AsArray(record["evidence"])
	if !evidenceOK || len(evidence) == 0 {
		*errors = append(*errors, Error("proposal-origin-evidence-missing", "proposal-origin row must preserve non-empty proposal evidence", Object{"line": line, "id": valueFrom(record, "id")}))
	} else if isCanonicalDigest(origin["evidenceDigest"]) {
		observed := SHA256Digest(evidence)
		if observed != origin["evidenceDigest"] {
			*errors = append(*errors, Error("proposal-origin-evidence-digest-mismatch", "origin.evidenceDigest must match preserved proposal evidence", Object{"line": line, "id": valueFrom(record, "id"), "expected": origin["evidenceDigest"], "observed": observed}))
		}
	}
	if isCanonicalDigest(origin["promotionEvidenceId"]) {
		observed := ProposalPromotionEvidenceID(origin)
		if observed != origin["promotionEvidenceId"] {
			*errors = append(*errors, Error("promotion-evidence-id-mismatch", "origin.promotionEvidenceId must link proposal and confirmation identities", Object{"line": line, "id": valueFrom(record, "id"), "expected": origin["promotionEvidenceId"], "observed": observed}))
		}
	}
	if isCanonicalDigest(origin["integrityDigest"]) {
		observed := ModelQueueIntegrityDigest(record)
		if observed != origin["integrityDigest"] {
			*errors = append(*errors, Error("promotion-integrity-mismatch", "proposal-origin row integrity digest does not match row content", Object{"line": line, "id": valueFrom(record, "id"), "expected": origin["integrityDigest"], "observed": observed}))
		}
	}
}

func ValidateRecord(value any, line int) (Object, []Object) {
	errors := []Object{}
	record, ok := AsObject(value)
	if !ok {
		return nil, []Object{Error("record-not-object", "row must be a plain non-Proxy JSON object", Object{"line": line})}
	}

	if findings := serializedDataFindings(record); len(findings) > 0 {
		addSerializedDataErrors(&errors, findings, line, false)
		return record, errors
	}

	addAuthorityShapeErrors(&errors, record, line, false)
	kind, _ := record["kind"].(string)
	if !queueKinds[kind] {
		errors = append(errors, Error("unknown-kind", "unsupported queue kind: "+JSString(valueFrom(record, "kind")), Object{"line": line, "kind": valueFrom(record, "kind")}))
		return record, errors
	}

	schema := schemaByKind[kind]
	for _, field := range schema.Required {
		if _, exists := record[field]; !exists {
			errors = append(errors, Error("missing-required-field", "missing required field: "+field, Object{"line": line, "kind": kind, "field": field}))
		}
	}
	if _, ok := NonEmptyString(record["id"]); !ok {
		errors = append(errors, Error("invalid-id", "id must be a non-empty string", Object{"line": line, "kind": kind}))
	}
	status, _ := record["status"].(string)
	if !schema.Statuses[status] {
		errors = append(errors, Error("invalid-status", "status must be one of: "+strings.Join(schema.StatusOrder, ", "), Object{"line": line, "kind": kind, "status": valueFrom(record, "status")}))
	}

	switch kind {
	case "hq.modelCommitQueued.v1":
		validateTargetRef(record, &errors, line)
		if _, ok := NonEmptyString(record["op"]); !ok {
			errors = append(errors, Error("invalid-op", "op must be a non-empty string", Object{"line": line, "id": valueFrom(record, "id")}))
		}
		payload, ok := AsObject(record["payload"])
		if !ok {
			errors = append(errors, Error("payload-not-object", "payload must be an object", Object{"line": line, "id": valueFrom(record, "id")}))
		} else {
			for _, smuggled := range forbiddenEmbeddedRows(payload, []string{"payload"}) {
				errors = append(errors, Error("payload-smuggled-row", "model payload must not embed source or reconcile rows: "+fmt.Sprint(smuggled["path"]), Object{
					"line": line, "kind": kind, "id": valueFrom(record, "id"), "fieldPath": smuggled["path"], "embeddedKind": smuggled["kind"], "reason": smuggled["reason"],
				}))
			}
		}
		if _, ok := NonEmptyString(record["confirmedBy"]); !ok {
			errors = append(errors, Error("invalid-confirmedBy", "confirmedBy must be a non-empty string", Object{"line": line, "id": valueFrom(record, "id")}))
		}
		validateModelQueueOrigin(record, &errors, line)
	case "hq.agentTaskQueued.v1":
		validateTargetRef(record, &errors, line)
		if _, ok := NonEmptyString(record["goal"]); !ok {
			errors = append(errors, Error("invalid-goal", "goal must be a non-empty string", Object{"line": line, "id": valueFrom(record, "id")}))
		}
		if _, ok := NonEmptyString(record["confirmedBy"]); !ok {
			errors = append(errors, Error("invalid-confirmedBy", "confirmedBy must be a non-empty string", Object{"line": line, "id": valueFrom(record, "id")}))
		}
		if context, exists := record["context"]; exists {
			if _, ok := AsArray(context); !ok {
				errors = append(errors, Error("context-not-array", "context must be an array when present", Object{"line": line, "id": valueFrom(record, "id")}))
			}
		}
		if acceptance, exists := record["acceptance"]; exists {
			if _, ok := AsArray(acceptance); !ok {
				errors = append(errors, Error("acceptance-not-array", "acceptance must be an array when present", Object{"line": line, "id": valueFrom(record, "id")}))
			}
		}
	case "hq.receipt.v1":
		if _, ok := NonEmptyString(record["queueId"]); !ok {
			errors = append(errors, Error("invalid-queueId", "queueId must be a non-empty string", Object{"line": line, "id": valueFrom(record, "id")}))
		}
		if digest, exists := record["queueDigest"]; exists {
			if _, ok := NonEmptyString(digest); !ok {
				errors = append(errors, Error("invalid-queueDigest", "queueDigest must be a non-empty string when present", Object{"line": line, "id": valueFrom(record, "id")}))
			}
		}
	}
	return record, errors
}

func ValidateProposalPromotionRecord(value any, line int, expectedOrigin Object) []Object {
	record, errors := ValidateRecord(value, line)
	if record == nil || record["kind"] != "hq.modelCommitQueued.v1" {
		errors = append(errors, Error("proposal-promotion-model-row-required", "proposal-promotion validation requires hq.modelCommitQueued.v1", Object{"line": line, "id": valueFrom(record, "id"), "kind": valueFrom(record, "kind")}))
		return errors
	}
	origin, ok := AsObject(record["origin"])
	if !ok || origin["kind"] != "proposal-promotion.v1" {
		errors = append(errors, Error("proposal-promotion-origin-required", "downstream proposal-gated validation requires origin.kind=proposal-promotion.v1", Object{"line": line, "id": valueFrom(record, "id"), "originKind": valueFrom(origin, "kind")}))
		return errors
	}
	if expectedOrigin == nil {
		errors = append(errors, Error("expected-proposal-origin-required", "proposal-promotion validation requires an expected origin from the trusted promotion boundary", Object{"line": line, "id": valueFrom(record, "id")}))
		return errors
	}
	for _, field := range proposalOriginFields {
		if fmt.Sprint(origin[field]) != fmt.Sprint(expectedOrigin[field]) {
			errors = append(errors, Error("proposal-promotion-expected-origin-mismatch", "origin."+field+" does not match the expected promotion origin", Object{"line": line, "id": valueFrom(record, "id"), "field": field, "expected": expectedOrigin[field], "observed": origin[field]}))
		}
	}
	return errors
}

func valueFrom(object Object, key string) any {
	if object == nil {
		return Undefined
	}
	value, exists := object[key]
	if !exists {
		return Undefined
	}
	return value
}
