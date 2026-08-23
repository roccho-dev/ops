package hq

import (
	"runtime"
	"runtime/debug"
	"testing"
)

func TestDeepNestingUsesBoundedResources(t *testing.T) {
	proposalAt := func(depth int) Object {
		p := validProposalForContract()
		root := Object{}
		cursor := root
		for i := 0; i < depth; i++ {
			next := Object{}
			cursor["next"] = next
			cursor = next
		}
		p["extra"] = root
		return p
	}
	measure := func(depth int) uint64 {
		old := debug.SetGCPercent(-1)
		defer debug.SetGCPercent(old)
		runtime.GC()
		var before, after runtime.MemStats
		runtime.ReadMemStats(&before)
		_, e := validateModelingProposal(proposalAt(depth), 1)
		runtime.ReadMemStats(&after)
		if len(e) != 0 {
			t.Fatal(describeForTest(objectSliceToAny(e)))
		}
		return after.TotalAlloc - before.TotalAlloc
	}
	shallow, deep := measure(512), measure(1024)
	if deep > shallow*3 {
		t.Fatalf("allocation growth %.2f", float64(deep)/float64(shallow))
	}
	if _, e := validateModelingProposal(proposalAt(20_000), 1); len(e) != 0 {
		t.Fatal(describeForTest(objectSliceToAny(e)))
	}
}
