package hq

import (
	"runtime"
	"runtime/debug"
	"strings"
	"testing"
)

func TestModelingProposalRequiredSerializedMeanings(t *testing.T) {
	t.Run("valid proposal validates and digest ignores object key order", func(t *testing.T) {
		proposal := validProposalForContract()
		_, errors := validateModelingProposal(proposal, 1)
		if len(errors) != 0 {
			t.Fatalf("valid proposal rejected: %s", describeForTest(objectSliceToAny(errors)))
		}
		digest := ProposalDigest(proposal)
		if !strings.HasPrefix(digest, "sha256:") {
			t.Fatalf("proposal digest: %s", digest)
		}
		reordered := Object{
			"status":             proposal["status"],
			"acceptanceCriteria": proposal["acceptanceCriteria"],
			"evidence":           proposal["evidence"],
			"proposedOperation":  proposal["proposedOperation"],
			"targetRef":          proposal["targetRef"],
			"sourceAgentTaskId":  proposal["sourceAgentTaskId"],
			"id":                 proposal["id"],
			"kind":               proposal["kind"],
		}
		if ProposalDigest(reordered) != digest {
			t.Fatalf("key order changed digest: %s != %s", ProposalDigest(reordered), digest)
		}
	})

	t.Run("serialized non-object proposals are rejected", func(t *testing.T) {
		for _, malformed := range []any{nil, []any{}, "proposal", float64(1), true} {
			_, errors := validateModelingProposal(malformed, 1)
			if got := errorCodesForTest(objectSliceToAny(errors)); len(got) != 1 || got[0] != "proposal-not-object" {
				t.Fatalf("malformed %#v codes = %v", malformed, got)
			}
		}
	})

	for _, testCase := range []struct {
		name string
		edit func(Object)
		code string
	}{
		{"empty evidence", func(proposal Object) { proposal["evidence"] = []any{} }, "evidence-missing"},
		{"target id missing", func(proposal Object) { delete(objectAtForTest(t, proposal, "targetRef"), "id") }, "targetRef-missing-id"},
		{"operation missing op", func(proposal Object) { delete(objectAtForTest(t, proposal, "proposedOperation"), "op") }, "proposal-op-missing"},
		{"acceptance criteria empty", func(proposal Object) { proposal["acceptanceCriteria"] = []any{} }, "acceptanceCriteria-missing"},
		{"invalid status", func(proposal Object) { proposal["status"] = "accepted" }, "invalid-proposal-status"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			proposal := cloneObjectForTest(t, validProposalForContract())
			testCase.edit(proposal)
			_, errors := validateModelingProposal(proposal, 1)
			requireCodeForTest(t, objectSliceToAny(errors), testCase.code)
		})
	}

	t.Run("benign author review and exact non-authority allowances remain valid", func(t *testing.T) {
		candidates := []Object{
			func() Object { value := validProposalForContract(); value["author"] = "human-reviewer"; return value }(),
			func() Object {
				value := validProposalForContract()
				value["review"] = Object{"acceptanceCriteria": []any{"still not accepted authority"}}
				return value
			}(),
			func() Object {
				value := validProposalForContract()
				value["evidence"] = append(value["evidence"].([]any), Object{"nonAuthority": true, "evidenceOnly": true})
				return value
			}(),
			func() Object {
				value := validProposalForContract()
				objectAtForTest(t, value, "proposedOperation", "payload")["authoritativeSourceName"] = "not authority token"
				return value
			}(),
		}
		for index, candidate := range candidates {
			_, errors := validateModelingProposal(candidate, 1)
			if len(errors) != 0 {
				t.Fatalf("benign candidate %d rejected: %s", index, describeForTest(objectSliceToAny(errors)))
			}
		}
	})
}

func TestPromotionRequiredSerializedMeanings(t *testing.T) {
	proposal := validProposalForContract()
	confirmation := validConfirmationForContract(proposal)

	t.Run("successful promotion links proposal queue origin and evidence receipt", func(t *testing.T) {
		result := PromoteProposalToModelQueue(proposal, confirmation)
		if result["ok"] != true {
			t.Fatalf("promotion failed: %s", describeForTest(result))
		}
		queueRow := ensureObject(result["queueRow"])
		origin := ensureObject(queueRow["origin"])
		if queueRow["kind"] != "hq.modelCommitQueued.v1" || origin["kind"] != "proposal-promotion.v1" || origin["proposalId"] != proposal["id"] || queueRow["proposalDigest"] != ProposalDigest(proposal) || origin["proposalDigest"] != ProposalDigest(proposal) {
			t.Fatalf("promotion linkage: %s", describeForTest(queueRow))
		}
		requireDeepEqualForTest(t, queueRow["evidence"], proposal["evidence"])
		if ModelQueueIntegrityDigest(queueRow) != origin["integrityDigest"] {
			t.Fatalf("integrity mismatch: %s", describeForTest(queueRow))
		}
		_, genericErrors := ValidateRecord(queueRow, 1)
		if len(genericErrors) != 0 {
			t.Fatalf("promoted queue rejected: %s", describeForTest(objectSliceToAny(genericErrors)))
		}
		dedicatedErrors := ValidateProposalPromotionRecord(queueRow, 1, origin)
		if len(dedicatedErrors) != 0 {
			t.Fatalf("dedicated validation failed: %s", describeForTest(objectSliceToAny(dedicatedErrors)))
		}

		receipt := ensureObject(result["promotionReceipt"])
		for key, want := range map[string]any{
			"kind": "proposal.promotionReceipt.v1", "id": origin["promotionEvidenceId"], "proposalId": proposal["id"], "proposalDigest": ProposalDigest(proposal), "queueId": queueRow["id"],
			"queueIntegrityDigest": origin["integrityDigest"], "confirmationDigest": origin["confirmationDigest"], "evidenceDigest": origin["evidenceDigest"], "promotionEvidenceId": origin["promotionEvidenceId"],
			"confirmedBy": "human-review", "evidenceOnly": true, "nonAuthority": true,
		} {
			if receipt[key] != want {
				t.Fatalf("promotion receipt %s = %#v, want %#v: %s", key, receipt[key], want, describeForTest(receipt))
			}
		}
	})

	t.Run("confirmation is explicit typed and digest-bound", func(t *testing.T) {
		for _, malformed := range []any{nil, []any{}, "confirmed", float64(1), true} {
			result := PromoteProposalToModelQueue(proposal, malformed)
			if result["ok"] != false || result["queueRow"] != nil {
				t.Fatalf("malformed confirmation passed: %s", describeForTest(result))
			}
			requireCodeForTest(t, result, "confirmation-missing")
		}

		cases := []struct {
			name    string
			confirm Object
			codes   []string
		}{
			{"missing confirm", Object{"confirmedBy": "human-review", "proposalDigest": ProposalDigest(proposal)}, []string{"confirmation-field-not-own", "confirmation-not-true"}},
			{"confirm false", Object{"confirm": false, "confirmedBy": "human-review", "proposalDigest": ProposalDigest(proposal)}, []string{"confirmation-not-true"}},
			{"confirm null", Object{"confirm": nil, "confirmedBy": "human-review", "proposalDigest": ProposalDigest(proposal)}, []string{"confirmation-field-type-invalid"}},
			{"confirmedBy null", Object{"confirm": true, "confirmedBy": nil, "proposalDigest": ProposalDigest(proposal)}, []string{"confirmation-field-type-invalid"}},
			{"confirmedBy empty", Object{"confirm": true, "confirmedBy": "", "proposalDigest": ProposalDigest(proposal)}, []string{"confirmedBy-missing"}},
			{"digest null", Object{"confirm": true, "confirmedBy": "human-review", "proposalDigest": nil}, []string{"confirmation-field-type-invalid"}},
			{"digest mismatch", Object{"confirm": true, "confirmedBy": "human-review", "proposalDigest": "sha256:wrong"}, []string{"proposal-digest-mismatch"}},
		}
		for _, testCase := range cases {
			t.Run(testCase.name, func(t *testing.T) {
				result := PromoteProposalToModelQueue(proposal, testCase.confirm)
				if result["ok"] != false || result["queueRow"] != nil {
					t.Fatalf("invalid confirmation passed: %s", describeForTest(result))
				}
				for _, code := range testCase.codes {
					requireCodeForTest(t, result, code)
				}
			})
		}
	})

	t.Run("only status proposed is promotable", func(t *testing.T) {
		for _, status := range []string{"rejected", "promoted"} {
			candidate := cloneObjectForTest(t, proposal)
			candidate["status"] = status
			result := PromoteProposalToModelQueue(candidate, validConfirmationForContract(candidate))
			if result["ok"] != false || result["queueRow"] != nil {
				t.Fatalf("status %s promoted: %s", status, describeForTest(result))
			}
			requireCodeForTest(t, result, "proposal-not-promotable")
		}
	})

	t.Run("failure result cannot leak promotion receipt", func(t *testing.T) {
		bad := cloneObjectForTest(t, confirmation)
		bad["proposalDigest"] = "sha256:wrong"
		result := PromoteProposalToModelQueue(proposal, bad)
		keys := []string{}
		for key := range result {
			keys = append(keys, key)
		}
		requireDeepEqualForTest(t, sortedStringsForTest(keys), []string{"errors", "ok", "queueRow"})
		if _, exists := result["promotionReceipt"]; exists {
			t.Fatalf("failed promotion emitted receipt: %s", describeForTest(result))
		}
	})
}

func TestPromotionContinuityAndTamperDetection(t *testing.T) {
	proposal := validProposalForContract()
	result := PromoteProposalToModelQueue(proposal, validConfirmationForContract(proposal))
	if result["ok"] != true {
		t.Fatalf("valid promotion failed: %s", describeForTest(result))
	}
	validRow := ensureObject(result["queueRow"])
	validOrigin := ensureObject(validRow["origin"])

	t.Run("generic direct-human row cannot satisfy proposal-gated port", func(t *testing.T) {
		relabeled := cloneObjectForTest(t, validRow)
		delete(relabeled, "proposalDigest")
		delete(relabeled, "evidence")
		relabeled["id"] = "mq_relabelled"
		relabeled["reason"] = "direct human"
		relabeled["origin"] = Object{"kind": "direct-human.v1", "confirmationId": "forged", "confirmedBy": relabeled["confirmedBy"]}
		_, genericErrors := ValidateRecord(relabeled, 1)
		if len(genericErrors) != 0 {
			t.Fatalf("explicit direct-human row rejected at generic boundary: %s", describeForTest(objectSliceToAny(genericErrors)))
		}
		dedicated := ValidateProposalPromotionRecord(relabeled, 1, validOrigin)
		requireCodeForTest(t, objectSliceToAny(dedicated), "proposal-promotion-origin-required")
	})

	t.Run("self-consistent rewrite cannot match separately retained expected origin", func(t *testing.T) {
		rewrittenBase := Object{
			"kind": "hq.modelCommitQueued.v1", "id": "mq_from_rewritten", "status": "queued",
			"targetRef": Object{"kind": "repoMap.node", "id": "pkg:rewritten"}, "op": "replace", "payload": Object{"complete": "rewrite"},
			"evidence": []any{Object{"kind": "digest", "value": "rewritten"}}, "reason": "promoted proposal rewritten", "confirmedBy": "rewriter",
			"proposalDigest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
		}
		rewritten := cloneObjectForTest(t, rewrittenBase)
		rewritten["origin"] = BuildProposalPromotionOrigin(rewrittenBase, "rewritten", rewrittenBase["proposalDigest"].(string), "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd", "rewriter")
		_, genericErrors := ValidateRecord(rewritten, 1)
		if len(genericErrors) != 0 {
			t.Fatalf("self-consistent rewrite invalid: %s", describeForTest(objectSliceToAny(genericErrors)))
		}
		ownOrigin := ensureObject(rewritten["origin"])
		if errors := ValidateProposalPromotionRecord(rewritten, 1, ownOrigin); len(errors) != 0 {
			t.Fatalf("rewrite not self-consistent: %s", describeForTest(objectSliceToAny(errors)))
		}
		continuity := ValidateProposalPromotionRecord(rewritten, 1, validOrigin)
		requireCodeForTest(t, objectSliceToAny(continuity), "proposal-promotion-expected-origin-mismatch")
	})

	for _, testCase := range []struct {
		name string
		edit func(Object)
		code string
	}{
		{"payload", func(row Object) { objectAtForTest(t, row, "payload")["to"] = "pkg:tampered" }, "promotion-integrity-mismatch"},
		{"evidence", func(row Object) { ensureObject(row["evidence"].([]any)[0])["value"] = "tampered" }, "proposal-origin-evidence-digest-mismatch"},
		{"proposal digest", func(row Object) {
			row["proposalDigest"] = "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
		}, "proposal-origin-digest-mismatch"},
		{"confirmation digest", func(row Object) {
			objectAtForTest(t, row, "origin")["confirmationDigest"] = "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
		}, "promotion-evidence-id-mismatch"},
		{"promotion evidence id", func(row Object) {
			objectAtForTest(t, row, "origin")["promotionEvidenceId"] = "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
		}, "promotion-evidence-id-mismatch"},
		{"integrity digest", func(row Object) {
			objectAtForTest(t, row, "origin")["integrityDigest"] = "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
		}, "promotion-integrity-mismatch"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			row := cloneObjectForTest(t, validRow)
			testCase.edit(row)
			errors := ValidateProposalPromotionRecord(row, 1, validOrigin)
			requireCodeForTest(t, objectSliceToAny(errors), testCase.code)
		})
	}
}

// RED: the Node pure promotion core snapshots the proposal before deriving its
// queue row. A Go replacement must not share mutable maps or slices with the
// caller, otherwise later caller mutation silently changes a previously
// returned queue intent and its digest-linked evidence.
func TestPromotionOutputIsDetachedFromCallerInput_RED(t *testing.T) {
	proposal := validProposalForContract()
	confirmation := validConfirmationForContract(proposal)
	proposalBefore := cloneObjectForTest(t, proposal)
	confirmationBefore := cloneObjectForTest(t, confirmation)

	result := PromoteProposalToModelQueue(proposal, confirmation)
	if result["ok"] != true {
		t.Fatalf("valid promotion failed: %s", describeForTest(result))
	}
	queueRow := ensureObject(result["queueRow"])

	requireDeepEqualForTest(t, proposal, proposalBefore)
	requireDeepEqualForTest(t, confirmation, confirmationBefore)

	objectAtForTest(t, proposal, "targetRef")["id"] = "pkg:mutated"
	objectAtForTest(t, proposal, "proposedOperation", "payload")["type"] = "dependsOn"
	ensureObject(proposal["evidence"].([]any)[0])["value"] = "sha256:mutated"
	proposal["status"] = "rejected"

	if objectAtForTest(t, queueRow, "targetRef")["id"] != "pkg:core" {
		t.Fatalf("queue target aliases proposal: %s", describeForTest(queueRow))
	}
	if objectAtForTest(t, queueRow, "payload")["type"] != "uses" {
		t.Fatalf("queue payload aliases proposal: %s", describeForTest(queueRow))
	}
	if ensureObject(queueRow["evidence"].([]any)[0])["value"] != "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" {
		t.Fatalf("queue evidence aliases proposal: %s", describeForTest(queueRow))
	}
}

// RED: the Node oracle validates a 20,000-level JSON-compatible proposal
// without throwing. Running that exact depth against the current Go traversal
// exhausts the sandbox because each recursive step copies the entire pointer
// path. This bounded growth check preserves the same scalability meaning while
// failing safely instead of OOM-killing CI.
func TestSerializedDeepNestingHasBoundedResourceGrowth_RED(t *testing.T) {
	measure := func(depth int) uint64 {
		proposal := validProposalForContract()
		deep := Object{}
		cursor := deep
		for index := 0; index < depth; index++ {
			next := Object{}
			cursor["next"] = next
			cursor = next
		}
		proposal["extra"] = deep

		previousGC := debug.SetGCPercent(-1)
		defer debug.SetGCPercent(previousGC)
		runtime.GC()
		var before runtime.MemStats
		var after runtime.MemStats
		runtime.ReadMemStats(&before)
		_, errors := validateModelingProposal(proposal, 1)
		runtime.ReadMemStats(&after)
		if len(errors) != 0 {
			t.Fatalf("depth %d rejected: %s", depth, describeForTest(objectSliceToAny(errors)))
		}
		return after.TotalAlloc - before.TotalAlloc
	}

	shallow := measure(512)
	deep := measure(1_024)
	if deep > shallow*3 {
		t.Fatalf("deep validation allocation growth is unbounded: depth512=%d depth1024=%d ratio=%.2f; Node oracle target depth=20000", shallow, deep, float64(deep)/float64(shallow))
	}
}
