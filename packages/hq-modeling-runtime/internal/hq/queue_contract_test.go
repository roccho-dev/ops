package hq

import (
	"math"
	"strings"
	"testing"
)

func TestQueueValidationIsExplicitAndFailClosed(t *testing.T) {
	t.Run("valid model agent and receipt", func(t *testing.T) {
		result := ValidateJSONL(rowsReaderForTest(t, validModelForContract(), validAgentForContract(), validReceiptForContract()))
		if result["ok"] != true || result["records"] != 3 {
			t.Fatalf("validation result: %s", describeForTest(result))
		}
	})

	t.Run("malformed JSON fails closed", func(t *testing.T) {
		result := ValidateJSONL(strings.NewReader("{not json}\n"))
		if result["ok"] != false {
			t.Fatalf("malformed JSON passed: %s", describeForTest(result))
		}
		requireCodeForTest(t, result, "invalid-json")
	})

	t.Run("top level JSON value must be object", func(t *testing.T) {
		for _, raw := range []string{"[]", `"row"`, "1", "null"} {
			value, parseError := ParseJSONLine([]byte(raw), 1)
			if parseError != nil {
				t.Fatalf("parse %q: %s", raw, describeForTest(parseError))
			}
			_, errors := ValidateRecord(value, 1)
			requireCodeForTest(t, objectSliceToAny(errors), "record-not-object")
		}
	})

	t.Run("required model fields and origin are explicit", func(t *testing.T) {
		missingTarget := cloneObjectForTest(t, validModelForContract())
		delete(missingTarget, "targetRef")
		_, errors := ValidateRecord(missingTarget, 1)
		requireCodeForTest(t, objectSliceToAny(errors), "missing-required-field")

		missingOrigin := cloneObjectForTest(t, validModelForContract())
		delete(missingOrigin, "origin")
		_, errors = ValidateRecord(missingOrigin, 1)
		requireCodeForTest(t, objectSliceToAny(errors), "missing-required-field")
		requireCodeForTest(t, objectSliceToAny(errors), "model-origin-not-object")
	})

	t.Run("agent optional arrays retain array type", func(t *testing.T) {
		bad := cloneObjectForTest(t, validAgentForContract())
		bad["context"] = "not-array"
		_, errors := ValidateRecord(bad, 1)
		requireCodeForTest(t, objectSliceToAny(errors), "context-not-array")

		bad = cloneObjectForTest(t, validAgentForContract())
		bad["acceptance"] = "not-array"
		_, errors = ValidateRecord(bad, 1)
		requireCodeForTest(t, objectSliceToAny(errors), "acceptance-not-array")
	})

	t.Run("receipt status cannot mint authority", func(t *testing.T) {
		bad := cloneObjectForTest(t, validReceiptForContract())
		bad["status"] = "accepted"
		_, errors := ValidateRecord(bad, 1)
		requireCodeForTest(t, objectSliceToAny(errors), "invalid-status")
		requireCodeForTest(t, objectSliceToAny(errors), "authority-shape-present")
	})

	t.Run("duplicate id fails without deleting first row", func(t *testing.T) {
		model := validModelForContract()
		agent := validAgentForContract()
		agent["id"] = model["id"]
		result := ValidateJSONL(rowsReaderForTest(t, model, agent))
		if result["ok"] != false {
			t.Fatalf("duplicate passed: %s", describeForTest(result))
		}
		requireCodeForTest(t, result, "duplicate-id")
	})

	t.Run("raw negative zero is not silently normalized before validation", func(t *testing.T) {
		model := validModelForContract()
		model["extra"] = math.Copysign(0, -1)
		_, errors := ValidateRecord(model, 1)
		requireCodeForTest(t, objectSliceToAny(errors), "record-data-invalid")
		found := false
		for _, errorRow := range errors {
			if errorRow["code"] == "record-data-invalid" && errorRow["reason"] == "negative-zero" && errorRow["path"] == "/extra" {
				found = true
			}
		}
		if !found {
			t.Fatalf("negative-zero finding missing: %s", describeForTest(objectSliceToAny(errors)))
		}
	})
}

func mutationPayloadForTest(t *testing.T, record Object) Object {
	t.Helper()
	if operation, ok := AsObject(record["proposedOperation"]); ok {
		payload, ok := AsObject(operation["payload"])
		if !ok {
			t.Fatalf("proposal payload is not object: %#v", operation["payload"])
		}
		return payload
	}
	payload, ok := AsObject(record["payload"])
	if !ok {
		t.Fatalf("queue payload is not object: %#v", record["payload"])
	}
	return payload
}

func TestAuthorityVocabularyIsBoundedAndFailClosed(t *testing.T) {
	type mutation struct {
		name      string
		apply     func(Object)
		dedicated bool
	}
	bypasses := []mutation{
		{"modelAuthoritativeClaim", func(record Object) { record["extra"] = Object{"modelAuthoritativeClaim": true} }, false},
		{"isAuthorized", func(record Object) { record["extra"] = Object{"isAuthorized": true} }, false},
		{"isAuthorised", func(record Object) { record["extra"] = Object{"isAuthorised": true} }, false},
		{"authorized kind", func(record Object) { record["extra"] = Object{"kind": "hq.authorizedRow.v1"} }, false},
		{"authorised kind", func(record Object) { record["extra"] = Object{"kind": "hq.authorisedRow.v1"} }, false},
		{"broader authoritative name", func(record Object) { record["extra"] = Object{"modelAuthoritativeSourceName": "forged"} }, false},
		{"hyphen authoritative source alias", func(record Object) { record["extra"] = Object{"authoritative-source-name": "catalog"} }, false},
		{"dot authoritative source alias", func(record Object) { record["extra"] = Object{"authoritative.source.name": "catalog"} }, false},
		{"upper snake authoritative source alias", func(record Object) { record["extra"] = Object{"AUTHORITATIVE_SOURCE_NAME": "catalog"} }, false},
		{"capital camel authoritative source alias", func(record Object) { record["extra"] = Object{"AuthoritativeSourceName": "catalog"} }, false},
		{"fused authoritative source alias", func(record Object) { record["extra"] = Object{"authoritativesourcename": "catalog"} }, true},
		{"upper fused authoritative source alias", func(record Object) { record["extra"] = Object{"AUTHORITATIVESOURCENAME": "catalog"} }, true},
		{"hyphen nonAuthority alias", func(record Object) { record["extra"] = Object{"non-authority": true} }, false},
		{"dot nonAuthority alias", func(record Object) { record["extra"] = Object{"non.authority": true} }, false},
		{"upper snake nonAuthority alias", func(record Object) { record["extra"] = Object{"NON_AUTHORITY": true} }, false},
		{"capital camel nonAuthority alias", func(record Object) { record["extra"] = Object{"NonAuthority": true} }, false},
		{"fused nonAuthority alias", func(record Object) { record["extra"] = Object{"nonauthority": true} }, true},
		{"upper fused nonAuthority alias", func(record Object) { record["extra"] = Object{"NONAUTHORITY": true} }, true},
		{"acceptedRow field", func(record Object) { record["acceptedRow"] = Object{} }, false},
		{"accepted kind infix", func(record Object) { record["extra"] = Object{"kind": "hq.acceptedRow.v1"} }, false},
		{"accepted status suffix", func(record Object) { record["extra"] = Object{"status": "accepted-status"} }, false},
		{"model authority infix", func(record Object) { record["evidence"] = []any{Object{"modelAuthorityClaim": true}} }, false},
		{"admission approval infix", func(record Object) { objectAtForTest(t, record, "targetRef")["isAdmissionApproved"] = true }, false},
		{"authorization field", func(record Object) { mutationPayloadForTest(t, record)["authorizationDecision"] = "pending" }, false},
		{"punctuation case", func(record Object) { record["extra"] = Object{"LEDGER-AUTHORITY.CLAIM": true} }, false},
		{"admit suffix", func(record Object) { record["extra"] = Object{"shouldAdmit": true} }, false},
		{"nonAuthority false", func(record Object) { record["nonAuthority"] = false }, false},
	}

	proposal := validProposalForContract()
	confirmation := validConfirmationForContract(proposal)
	validPromotion := PromoteProposalToModelQueue(proposal, confirmation)
	if validPromotion["ok"] != true {
		t.Fatalf("valid promotion failed: %s", describeForTest(validPromotion))
	}

	for _, testCase := range bypasses {
		t.Run(testCase.name, func(t *testing.T) {
			proposalCandidate := cloneObjectForTest(t, validProposalForContract())
			testCase.apply(proposalCandidate)
			_, proposalErrors := validateModelingProposal(proposalCandidate, 1)
			requireAnyCodeForTest(t, objectSliceToAny(proposalErrors), "authority-field-present", "authority-shape-present")

			promotion := PromoteProposalToModelQueue(proposalCandidate, validConfirmationForContract(proposalCandidate))
			if promotion["ok"] != false {
				t.Fatalf("authority-bearing proposal promoted: %s", describeForTest(promotion))
			}
			requireAnyCodeForTest(t, promotion, "authority-field-present", "authority-shape-present")

			queueCandidate := cloneObjectForTest(t, validModelForContract())
			testCase.apply(queueCandidate)
			_, queueErrors := ValidateRecord(queueCandidate, 1)
			requireAnyCodeForTest(t, objectSliceToAny(queueErrors), "authority-field-present", "authority-shape-present")

			if testCase.dedicated {
				dedicated := cloneObjectForTest(t, ensureObject(validPromotion["queueRow"]))
				testCase.apply(dedicated)
				errors := ValidateProposalPromotionRecord(dedicated, 1, ensureObject(ensureObject(validPromotion["queueRow"])["origin"]))
				requireAnyCodeForTest(t, objectSliceToAny(errors), "authority-field-present", "authority-shape-present")
			}
		})
	}

	for _, invalid := range []any{"", "   ", float64(0), false, nil} {
		t.Run("invalid authoritativeSourceName "+JSString(invalid), func(t *testing.T) {
			proposalCandidate := cloneObjectForTest(t, validProposalForContract())
			payload := objectAtForTest(t, proposalCandidate, "proposedOperation", "payload")
			payload["authoritativeSourceName"] = invalid
			_, errors := validateModelingProposal(proposalCandidate, 1)
			requireAnyCodeForTest(t, objectSliceToAny(errors), "authority-field-present", "authority-shape-present")

			queueCandidate := cloneObjectForTest(t, validModelForContract())
			objectAtForTest(t, queueCandidate, "payload")["authoritativeSourceName"] = invalid
			_, errors = ValidateRecord(queueCandidate, 1)
			requireAnyCodeForTest(t, objectSliceToAny(errors), "authority-field-present", "authority-shape-present")
		})
	}

	t.Run("narrow exact allowances do not create false positives", func(t *testing.T) {
		proposalCandidate := cloneObjectForTest(t, validProposalForContract())
		payload := objectAtForTest(t, proposalCandidate, "proposedOperation", "payload")
		payload["admittanceOhms"] = float64(50)
		payload["authoritativeSourceName"] = "catalog"
		payload["nonAuthority"] = true
		_, errors := validateModelingProposal(proposalCandidate, 1)
		if len(errors) != 0 {
			t.Fatalf("benign proposal rejected: %s", describeForTest(objectSliceToAny(errors)))
		}

		queueCandidate := cloneObjectForTest(t, validModelForContract())
		queuePayload := objectAtForTest(t, queueCandidate, "payload")
		queuePayload["admittanceOhms"] = float64(50)
		queuePayload["authoritativeSourceName"] = "catalog"
		queuePayload["nonAuthority"] = true
		_, errors = ValidateRecord(queueCandidate, 1)
		if len(errors) != 0 {
			t.Fatalf("benign queue rejected: %s", describeForTest(objectSliceToAny(errors)))
		}
	})
}

func TestModelPayloadRejectsSourceAndReconcileRows(t *testing.T) {
	for _, embeddedKind := range []string{"source.observation.v1", "SOURCE.RECEIPT.V1", "model_source_reconcile.v1"} {
		t.Run(embeddedKind, func(t *testing.T) {
			model := cloneObjectForTest(t, validModelForContract())
			model["payload"] = Object{
				"edge":     validModelForContract()["payload"],
				"embedded": Object{"kind": embeddedKind, "id": "embedded", "status": "observed"},
			}
			_, errors := ValidateRecord(model, 1)
			requireCodeForTest(t, objectSliceToAny(errors), "payload-smuggled-row")
		})
	}
}
