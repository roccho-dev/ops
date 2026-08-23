package hq

import (
	"strings"
	"testing"
)

const validQueueFixture = `{"kind":"hq.modelCommitQueued.v1","id":"m1","status":"queued","targetRef":{"kind":"package","id":"pkg:a"},"op":"addEdge","payload":{"from":"pkg:a","to":"pkg:b","type":"uses"},"reason":"fixture","confirmedBy":"human","origin":{"kind":"direct-human.v1","confirmationId":"c1","confirmedBy":"human"}}
{"kind":"hq.agentTaskQueued.v1","id":"a1","status":"queued","targetRef":{"kind":"package","id":"pkg:a"},"goal":"inspect","context":["x"],"acceptance":["y"],"confirmedBy":"human"}
{"kind":"hq.receipt.v1","id":"r1","status":"processed","queueId":"m0"}
`

func TestValidQueueRunsThroughProofPipeline(t *testing.T) {
	validated := ValidateJSONL(strings.NewReader(validQueueFixture))
	if validated["ok"] != true || validated["records"] != 3 {
		t.Fatalf("validation result: %#v", validated)
	}

	worker := RunLocalWorkerWithReceiptsJSONL(strings.NewReader(validQueueFixture))
	if worker["ok"] != true || worker["receipts"] != 3 {
		t.Fatalf("worker result: %#v", worker)
	}
	projection := BuildRepoMapProjection(worker)
	if projection["ok"] != true {
		t.Fatalf("projection result: %#v", projection)
	}
}

func TestAuthorityAndSourceSmugglingFailClosed(t *testing.T) {
	fixture := `{"kind":"hq.modelCommitQueued.v1","id":"bad-source","status":"queued","targetRef":{"kind":"package","id":"pkg:a"},"op":"addEdge","payload":{"nested":{"kind":"source.observation.v1"}},"confirmedBy":"human","origin":{"kind":"direct-human.v1","confirmationId":"c1","confirmedBy":"human"}}
{"kind":"hq.agentTaskQueued.v1","id":"bad-authority","status":"queued","targetRef":{"kind":"package","id":"pkg:a"},"goal":"inspect","confirmedBy":"human","modelAuthoritativeClaim":true}
`
	result := ValidateJSONL(strings.NewReader(fixture))
	if result["ok"] != false {
		t.Fatalf("invalid input was accepted: %#v", result)
	}
	codes := map[string]bool{}
	for _, raw := range result["errors"].([]any) {
		codes[ensureObject(raw)["code"].(string)] = true
	}
	for _, required := range []string{"payload-smuggled-row", "authority-field-present"} {
		if !codes[required] {
			t.Fatalf("missing error code %s in %#v", required, result["errors"])
		}
	}
}
