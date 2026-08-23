package hq

import (
	"testing"
)

func TestProposalValidationIsCanonicalAndFailClosed(t *testing.T) {
	proposal := validProposalForContract()
	if _, errors := validateModelingProposal(proposal, 1); len(errors) != 0 {
		t.Fatal(describeForTest(objectSliceToAny(errors)))
	}
	requireSHA(t, ProposalDigest(proposal))
	reordered := Object{"status": proposal["status"], "acceptanceCriteria": proposal["acceptanceCriteria"], "evidence": proposal["evidence"], "proposedOperation": proposal["proposedOperation"], "targetRef": proposal["targetRef"], "sourceAgentTaskId": proposal["sourceAgentTaskId"], "id": proposal["id"], "kind": proposal["kind"]}
	if ProposalDigest(reordered) != ProposalDigest(proposal) {
		t.Fatal("object key order changed digest")
	}

	for _, value := range []any{nil, []any{}, "proposal", float64(1), true} {
		_, errors := validateModelingProposal(value, 1)
		codes := errorCodesForTest(objectSliceToAny(errors))
		if len(codes) != 1 || codes[0] != "proposal-not-object" {
			t.Fatalf("%#v: %v", value, codes)
		}
	}
	for _, tc := range []struct {
		name string
		edit func(Object)
		code string
	}{
		{"evidence", func(p Object) { p["evidence"] = []any{} }, "evidence-missing"},
		{"target", func(p Object) { delete(objectAtForTest(t, p, "targetRef"), "id") }, "targetRef-missing-id"},
		{"operation", func(p Object) { delete(objectAtForTest(t, p, "proposedOperation"), "op") }, "proposal-op-missing"},
		{"criteria", func(p Object) { p["acceptanceCriteria"] = []any{} }, "acceptanceCriteria-missing"},
		{"status", func(p Object) { p["status"] = "accepted" }, "invalid-proposal-status"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p := cloneObjectForTest(t, proposal)
			tc.edit(p)
			_, e := validateModelingProposal(p, 1)
			requireCodeForTest(t, objectSliceToAny(e), tc.code)
		})
	}

	for _, candidate := range []Object{
		func() Object { p := validProposalForContract(); p["author"] = "human"; return p }(),
		func() Object {
			p := validProposalForContract()
			p["review"] = Object{"acceptanceCriteria": []any{"not authority"}}
			return p
		}(),
		func() Object {
			p := validProposalForContract()
			p["evidence"] = append(p["evidence"].([]any), Object{"nonAuthority": true, "evidenceOnly": true})
			return p
		}(),
		func() Object {
			p := validProposalForContract()
			objectAtForTest(t, p, "proposedOperation", "payload")["authoritativeSourceName"] = "catalog"
			return p
		}(),
	} {
		if _, e := validateModelingProposal(candidate, 1); len(e) != 0 {
			t.Fatal(describeForTest(objectSliceToAny(e)))
		}
	}
}
