package hq

import (
	"fmt"
	"math"
	"strings"
)

func serializedDataFindings(value any) []Object {
	findings := []Object{}
	var visit func(any, []any)
	visit = func(node any, path []any) {
		switch typed := node.(type) {
		case float64:
			if typed == 0 && math.Signbit(typed) {
				findings = append(findings, Object{
					"path":     pointerFromAny(path),
					"segments": append([]any{}, path...),
					"reason":   "negative-zero",
				})
			}
		case Object:
			visit(map[string]any(typed), path)
		case map[string]any:
			for _, key := range sortedKeys(Object(typed)) {
				visit(typed[key], append(append([]any{}, path...), key))
			}
		case []any:
			for index, nested := range typed {
				visit(nested, append(append([]any{}, path...), index))
			}
		}
	}
	visit(value, nil)
	return findings
}

func addSerializedDataErrors(errors *[]Object, findings []Object, line int, proposal bool) {
	for _, finding := range findings {
		path, _ := finding["path"].(string)
		reason, _ := finding["reason"].(string)
		code := "record-data-invalid"
		message := "queue row is not complete JSON data at " + path + ": " + reason
		if proposal {
			code = "proposal-data-invalid"
			message = "proposal data is not JSON-compatible at " + path + ": " + reason
		}
		*errors = append(*errors, Error(code, message, Object{
			"line":   line,
			"path":   path,
			"reason": reason,
			"detail": valueOrUndefined(finding, "detail"),
			"symbol": valueOrUndefined(finding, "symbol"),
		}))
	}
}

func addAuthorityShapeErrors(errors *[]Object, record Object, line int, proposal bool) {
	for _, finding := range findAuthorityBearingShapes(record) {
		reason, _ := finding["reason"].(string)
		code := "authority-shape-present"
		if reason == "forbidden-field" {
			code = "authority-field-present"
		}
		segments, _ := finding["segments"].([]any)
		fieldPath := pathText(segments)
		message := "authority-bearing shape is prohibited: " + fieldPath
		if proposal {
			message = "authority-bearing proposal shape is prohibited: " + fieldPath
		}
		extra := Object{
			"line":            line,
			"id":              valueFrom(record, "id"),
			"fieldPath":       strings.TrimPrefix(fieldPath, "$"),
			"reason":          valueOrUndefined(finding, "reason"),
			"detail":          valueOrUndefined(finding, "detail"),
			"concept":         valueOrUndefined(finding, "concept"),
			"normalizedField": valueOrUndefined(finding, "normalizedField"),
			"normalizedValue": valueOrUndefined(finding, "normalizedValue"),
		}
		if proposal {
			extra["path"] = pointerFromAny(segments)
			extra["fieldPath"] = strings.TrimPrefix(fieldPath, "$.")
		} else {
			extra["kind"] = valueOrUndefined(record, "kind")
		}
		*errors = append(*errors, Error(code, message, extra))
	}
}

func validateTargetRef(record Object, errors *[]Object, line int) {
	target, ok := AsObject(record["targetRef"])
	if !ok {
		*errors = append(*errors, Error("targetRef-not-object", "targetRef must be an object", Object{"line": line, "id": valueFrom(record, "id")}))
		return
	}
	if _, ok := NonEmptyString(target["kind"]); !ok {
		*errors = append(*errors, Error("targetRef-missing-kind", "targetRef.kind must be a non-empty string", Object{"line": line, "id": valueFrom(record, "id")}))
	}
	if _, ok := NonEmptyString(target["id"]); !ok {
		*errors = append(*errors, Error("targetRef-missing-id", "targetRef.id must be a non-empty string", Object{"line": line, "id": valueFrom(record, "id")}))
	}
}

func forbiddenEmbeddedRows(value any, path []string) []Object {
	found := []Object{}
	var visit func(any, []string)
	visit = func(node any, current []string) {
		switch typed := node.(type) {
		case Object:
			visit(map[string]any(typed), current)
		case map[string]any:
			if kind, ok := typed["kind"].(string); ok {
				lower := strings.ToLower(kind)
				if lower == "source.observation.v1" || lower == "source.receipt.v1" || lower == "model_source_reconcile.v1" ||
					strings.HasPrefix(lower, "source.") || strings.HasPrefix(lower, "admission.") || strings.HasPrefix(lower, "accepted.") {
					found = append(found, Object{"path": strings.Join(append(current, "kind"), "."), "kind": kind, "reason": "forbidden-kind"})
				}
				// Preserve the current Node oracle's explicit reconcile guard in
				// addition to the generic forbidden-kind match.
				if lower == "model_source_reconcile.v1" {
					found = append(found, Object{"path": strings.Join(append(current, "kind"), "."), "kind": kind, "reason": "forbidden-kind"})
				}
			}
			for _, key := range sortedKeys(Object(typed)) {
				visit(typed[key], append(append([]string{}, current...), key))
			}
		case []any:
			for index, nested := range typed {
				visit(nested, append(append([]string{}, current...), fmt.Sprint(index)))
			}
		}
	}
	visit(value, path)
	return found
}

func isCanonicalDigest(value any) bool {
	text, ok := value.(string)
	return ok && canonicalDigest.MatchString(text)
}

func ModelQueueIntegrityDigest(record Object) string {
	material := CloneJSON(record).(map[string]any)
	if origin, ok := AsObject(material["origin"]); ok {
		delete(origin, "integrityDigest")
		material["origin"] = origin
	}
	return SHA256Digest(material)
}

func ProposalPromotionEvidenceID(origin Object) string {
	return SHA256Digest(Object{
		"kind":               "proposal.promotionEvidence.v1",
		"proposalId":         origin["proposalId"],
		"proposalDigest":     origin["proposalDigest"],
		"confirmationDigest": origin["confirmationDigest"],
		"confirmedBy":        origin["confirmedBy"],
	})
}

func BuildProposalPromotionOrigin(queueRow Object, proposalID, proposalDigest, confirmationDigest, confirmedBy string) Object {
	origin := Object{
		"kind":               "proposal-promotion.v1",
		"proposalId":         proposalID,
		"proposalDigest":     proposalDigest,
		"confirmationDigest": confirmationDigest,
		"confirmedBy":        confirmedBy,
		"evidenceDigest":     SHA256Digest(queueRow["evidence"]),
	}
	origin["promotionEvidenceId"] = ProposalPromotionEvidenceID(origin)
	candidate := CloneJSON(queueRow).(map[string]any)
	candidate["origin"] = origin
	origin["integrityDigest"] = ModelQueueIntegrityDigest(candidate)
	return origin
}

var proposalOriginFields = []string{
	"kind", "proposalId", "proposalDigest", "confirmationDigest", "confirmedBy", "evidenceDigest", "promotionEvidenceId", "integrityDigest",
}
