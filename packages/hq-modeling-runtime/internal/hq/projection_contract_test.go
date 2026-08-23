package hq

import (
	"testing"
)

func TestProjectionIsDeterministicAndNonAuthoritative(t *testing.T) {
	result := BuildRepoMapProjection(RunLocalWorkerWithReceiptsJSONL(rowsReaderForTest(t, validModelForContract(), validAgentForContract())))
	requireFields(t, result, Object{"ok": true})
	projection := ensureObject(result["projection"])
	requireFields(t, projection, Object{"kind": "repoMap.projection.v1", "generatedBy": "hq-modeling-runtime", "evidenceOnly": true, "nonAuthority": true})
	requireSHA(t, projection["projectionDigest"])
	source := ensureObject(projection["source"])
	requireSHA(t, source["receiptDigest"])
	requireSHA(t, source["stateDigest"])
	ids := []string{}
	for _, raw := range projection["nodes"].([]any) {
		ids = append(ids, ensureObject(raw)["id"].(string))
	}
	requireDeepEqualForTest(t, sortedStringsForTest(ids), []string{"pkg:core", "pkg:ui"})
	edges := projection["edges"].([]any)
	if len(edges) != 1 {
		t.Fatal(describeForTest(projection))
	}
	requireDeepEqualForTest(t, edges[0], Object{"id": "edge:pkg:core->pkg:ui:uses", "from": "pkg:core", "to": "pkg:ui", "type": "uses", "sourceQueueId": "mq_001", "evidenceOnly": true})
	if len(projection["pendingAgentTasks"].([]any)) != 1 || len(projection["receipts"].([]any)) != 2 {
		t.Fatal(describeForTest(projection))
	}
	requireAbsent(t, projection, "accepted", "acceptedLedger", "sourceModelAuthority")

	for _, tc := range []struct {
		name string
		row  Object
		code string
	}{
		{"authority", func() Object { r := validModelForContract(); r["payload"] = Object{"acceptedLedger": true}; return r }(), "authority-field-present"},
		{"source", func() Object {
			r := validModelForContract()
			r["payload"] = Object{"embedded": Object{"kind": "source.observation.v1", "id": "obs", "status": "observed"}}
			return r
		}(), "payload-smuggled-row"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			bad := BuildRepoMapProjection(RunLocalWorkerWithReceiptsJSONL(rowsReaderForTest(t, tc.row)))
			requireFields(t, bad, Object{"ok": false})
			p := ensureObject(bad["projection"])
			if len(p["edges"].([]any)) != 0 {
				t.Fatal(describeForTest(p))
			}
			requireCodeForTest(t, Object{"errors": p["errors"]}, tc.code)
		})
	}
}
