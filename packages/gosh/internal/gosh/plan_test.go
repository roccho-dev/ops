package gosh

import (
	"strings"
	"testing"
)

func TestPlanDerivesOutputDependencies(t *testing.T) {
	src := `{"kind":"gosh.tool.require.v1","id":"x","resolver":"absolute","programAbs":"/bin/true"}
{"kind":"gosh.target.upsert.v1","id":"a","targetKind":"exec","tool":"x"}
{"kind":"gosh.target.output.set.v1","target":"a","id":"o","path":"dist/a"}
{"kind":"gosh.target.upsert.v1","id":"b","targetKind":"exec","tool":"x"}
{"kind":"gosh.target.input.add.v1","target":"b","id":"i","path":"dist/a"}
`
	s, err := LoadState(strings.NewReader(src))
	if err != nil {
		t.Fatal(err)
	}
	p, err := BuildPlan(s, "b")
	if err != nil {
		t.Fatal(err)
	}
	if len(p.Steps) != 3 || p.Steps[1].ID != "target:a" || p.Steps[2].ID != "target:b" {
		t.Fatalf("unexpected plan %#v", p.Steps)
	}
}
func TestPlanCycleFailsWithPath(t *testing.T) {
	src := `{"kind":"gosh.tool.require.v1","id":"x","resolver":"absolute","programAbs":"/bin/true"}
{"kind":"gosh.target.upsert.v1","id":"a","targetKind":"exec","tool":"x"}
{"kind":"gosh.target.output.set.v1","target":"a","id":"o","path":"a.out"}
{"kind":"gosh.target.input.add.v1","target":"a","id":"i","path":"b.out"}
{"kind":"gosh.target.upsert.v1","id":"b","targetKind":"exec","tool":"x"}
{"kind":"gosh.target.output.set.v1","target":"b","id":"o","path":"b.out"}
{"kind":"gosh.target.input.add.v1","target":"b","id":"i","path":"a.out"}
`
	s, err := LoadState(strings.NewReader(src))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = BuildPlan(s, "a"); err == nil || !strings.Contains(err.Error(), "cycle") {
		t.Fatalf("expected cycle, got %v", err)
	}
}
