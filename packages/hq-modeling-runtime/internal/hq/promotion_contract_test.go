package hq

import (
	"testing"
)

func TestPromotionRequiresBoundHumanConfirmation(t *testing.T) {
	proposal := validProposalForContract()
	confirmation := validConfirmationForContract(proposal)
	result := PromoteProposalToModelQueue(proposal, confirmation)
	requireFields(t, result, Object{"ok": true})
	row := ensureObject(result["queueRow"])
	origin := ensureObject(row["origin"])
	requireFields(t, row, Object{"kind": "hq.modelCommitQueued.v1", "proposalDigest": ProposalDigest(proposal)})
	requireFields(t, origin, Object{"kind": "proposal-promotion.v1", "proposalId": proposal["id"], "proposalDigest": ProposalDigest(proposal)})
	requireDeepEqualForTest(t, row["evidence"], proposal["evidence"])
	if ModelQueueIntegrityDigest(row) != origin["integrityDigest"] {
		t.Fatal(describeForTest(row))
	}
	if _, e := ValidateRecord(row, 1); len(e) != 0 {
		t.Fatal(describeForTest(objectSliceToAny(e)))
	}
	if e := ValidateProposalPromotionRecord(row, 1, origin); len(e) != 0 {
		t.Fatal(describeForTest(objectSliceToAny(e)))
	}
	receipt := ensureObject(result["promotionReceipt"])
	requireFields(t, receipt, Object{"kind": "proposal.promotionReceipt.v1", "id": origin["promotionEvidenceId"], "proposalId": proposal["id"], "proposalDigest": ProposalDigest(proposal), "queueId": row["id"], "queueIntegrityDigest": origin["integrityDigest"], "confirmationDigest": origin["confirmationDigest"], "evidenceDigest": origin["evidenceDigest"], "promotionEvidenceId": origin["promotionEvidenceId"], "confirmedBy": "human-review", "evidenceOnly": true, "nonAuthority": true})

	for _, value := range []any{nil, []any{}, "confirmed", float64(1), true} {
		r := PromoteProposalToModelQueue(proposal, value)
		requireResult(t, r, Object{"ok": false, "queueRow": nil}, "confirmation-missing")
	}
	for _, tc := range []struct {
		name  string
		c     Object
		codes []string
	}{
		{"missing", Object{"confirmedBy": "human-review", "proposalDigest": ProposalDigest(proposal)}, []string{"confirmation-field-not-own", "confirmation-not-true"}},
		{"false", Object{"confirm": false, "confirmedBy": "human-review", "proposalDigest": ProposalDigest(proposal)}, []string{"confirmation-not-true"}},
		{"null", Object{"confirm": nil, "confirmedBy": "human-review", "proposalDigest": ProposalDigest(proposal)}, []string{"confirmation-field-type-invalid"}},
		{"actor-null", Object{"confirm": true, "confirmedBy": nil, "proposalDigest": ProposalDigest(proposal)}, []string{"confirmation-field-type-invalid"}},
		{"actor-empty", Object{"confirm": true, "confirmedBy": "", "proposalDigest": ProposalDigest(proposal)}, []string{"confirmedBy-missing"}},
		{"digest-null", Object{"confirm": true, "confirmedBy": "human-review", "proposalDigest": nil}, []string{"confirmation-field-type-invalid"}},
		{"digest-mismatch", Object{"confirm": true, "confirmedBy": "human-review", "proposalDigest": "sha256:wrong"}, []string{"proposal-digest-mismatch"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := PromoteProposalToModelQueue(proposal, tc.c)
			requireFields(t, r, Object{"ok": false, "queueRow": nil})
			for _, code := range tc.codes {
				requireCodeForTest(t, r, code)
			}
		})
	}
	for _, status := range []string{"rejected", "promoted"} {
		p := cloneObjectForTest(t, proposal)
		p["status"] = status
		r := PromoteProposalToModelQueue(p, validConfirmationForContract(p))
		requireResult(t, r, Object{"ok": false, "queueRow": nil}, "proposal-not-promotable")
	}
	bad := cloneObjectForTest(t, confirmation)
	bad["proposalDigest"] = "sha256:wrong"
	failed := PromoteProposalToModelQueue(proposal, bad)
	requireAbsent(t, failed, "promotionReceipt")
	requireDeepEqualForTest(t, sortedStringsForTest(func() []string {
		r := []string{}
		for k := range failed {
			r = append(r, k)
		}
		return r
	}()), []string{"errors", "ok", "queueRow"})
}
