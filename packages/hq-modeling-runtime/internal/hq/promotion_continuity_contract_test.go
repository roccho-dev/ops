package hq

import (
	"testing"
)

func TestPromotionRejectsContinuityBreaksAndTampering(t *testing.T) {
	proposal := validProposalForContract()
	promoted := PromoteProposalToModelQueue(proposal, validConfirmationForContract(proposal))
	requireFields(t, promoted, Object{"ok": true})
	row := ensureObject(promoted["queueRow"])
	origin := ensureObject(row["origin"])

	relabeled := cloneObjectForTest(t, row)
	delete(relabeled, "proposalDigest")
	delete(relabeled, "evidence")
	relabeled["id"] = "mq_relabelled"
	relabeled["reason"] = "direct human"
	relabeled["origin"] = Object{"kind": "direct-human.v1", "confirmationId": "forged", "confirmedBy": relabeled["confirmedBy"]}
	if _, e := ValidateRecord(relabeled, 1); len(e) != 0 {
		t.Fatal(describeForTest(objectSliceToAny(e)))
	}
	requireCodeForTest(t, objectSliceToAny(ValidateProposalPromotionRecord(relabeled, 1, origin)), "proposal-promotion-origin-required")

	base := Object{"kind": "hq.modelCommitQueued.v1", "id": "mq_from_rewritten", "status": "queued", "targetRef": Object{"kind": "repoMap.node", "id": "pkg:rewritten"}, "op": "replace", "payload": Object{"complete": "rewrite"}, "evidence": []any{Object{"kind": "digest", "value": "rewritten"}}, "reason": "promoted proposal rewritten", "confirmedBy": "rewriter", "proposalDigest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}
	rewritten := cloneObjectForTest(t, base)
	rewritten["origin"] = BuildProposalPromotionOrigin(base, "rewritten", base["proposalDigest"].(string), "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd", "rewriter")
	if _, e := ValidateRecord(rewritten, 1); len(e) != 0 {
		t.Fatal(describeForTest(objectSliceToAny(e)))
	}
	own := ensureObject(rewritten["origin"])
	if e := ValidateProposalPromotionRecord(rewritten, 1, own); len(e) != 0 {
		t.Fatal(describeForTest(objectSliceToAny(e)))
	}
	requireCodeForTest(t, objectSliceToAny(ValidateProposalPromotionRecord(rewritten, 1, origin)), "proposal-promotion-expected-origin-mismatch")

	hash := "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
	for _, tc := range []struct {
		name string
		edit func(Object)
		code string
	}{
		{"payload", func(r Object) { objectAtForTest(t, r, "payload")["to"] = "tampered" }, "promotion-integrity-mismatch"},
		{"evidence", func(r Object) { ensureObject(r["evidence"].([]any)[0])["value"] = "tampered" }, "proposal-origin-evidence-digest-mismatch"},
		{"proposal", func(r Object) { r["proposalDigest"] = hash }, "proposal-origin-digest-mismatch"},
		{"confirmation", func(r Object) { objectAtForTest(t, r, "origin")["confirmationDigest"] = hash }, "promotion-evidence-id-mismatch"},
		{"evidence-id", func(r Object) { objectAtForTest(t, r, "origin")["promotionEvidenceId"] = hash }, "promotion-evidence-id-mismatch"},
		{"integrity", func(r Object) { objectAtForTest(t, r, "origin")["integrityDigest"] = hash }, "promotion-integrity-mismatch"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := cloneObjectForTest(t, row)
			tc.edit(r)
			requireCodeForTest(t, objectSliceToAny(ValidateProposalPromotionRecord(r, 1, origin)), tc.code)
		})
	}
}
