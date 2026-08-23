package hq

import (
	"testing"
)

func TestPromotionOutputDoesNotAliasInput(t *testing.T) {
	proposal := validProposalForContract()
	confirmation := validConfirmationForContract(proposal)
	p0 := cloneObjectForTest(t, proposal)
	c0 := cloneObjectForTest(t, confirmation)
	result := PromoteProposalToModelQueue(proposal, confirmation)
	requireFields(t, result, Object{"ok": true})
	row := ensureObject(result["queueRow"])
	requireDeepEqualForTest(t, proposal, p0)
	requireDeepEqualForTest(t, confirmation, c0)
	objectAtForTest(t, proposal, "targetRef")["id"] = "mutated"
	objectAtForTest(t, proposal, "proposedOperation", "payload")["type"] = "dependsOn"
	ensureObject(proposal["evidence"].([]any)[0])["value"] = "mutated"
	proposal["status"] = "rejected"
	requireFields(t, objectAtForTest(t, row, "targetRef"), Object{"id": "pkg:core"})
	requireFields(t, objectAtForTest(t, row, "payload"), Object{"type": "uses"})
	if ensureObject(row["evidence"].([]any)[0])["value"] != "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" {
		t.Fatal(describeForTest(row))
	}
}
