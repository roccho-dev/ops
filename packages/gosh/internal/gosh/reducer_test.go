package gosh

import (
	"strings"
	"testing"
)

func TestReducerLWWAndTombstones(t *testing.T) {
	src := strings.Join([]string{
		`{"kind":"gosh.tool.require.v1","id":"x","resolver":"absolute","programAbs":"/bin/false"}`,
		`{"kind":"gosh.tool.require.v1","id":"x","resolver":"absolute","programAbs":"/bin/true"}`,
		`{"kind":"gosh.target.upsert.v1","id":"app","targetKind":"exec","tool":"x"}`,
		`{"kind":"gosh.target.input.add.v1","target":"app","id":"src","path":"a"}`,
		`{"kind":"gosh.target.input.remove.v1","target":"app","id":"src"}`,
	}, "\n") + "\n"
	s, err := LoadState(strings.NewReader(src))
	if err != nil {
		t.Fatal(err)
	}
	if s.Tools["x"].ProgramAbs != "/bin/true" {
		t.Fatalf("later value lost: %+v", s.Tools["x"])
	}
	if !s.Targets["app"].Inputs["src"].Deleted {
		t.Fatal("member tombstone missing")
	}
}
func TestParseFailsClosed(t *testing.T) {
	cases := []string{
		`{"kind":"gosh.unknown.v1"}`,
		`{"kind":"gosh.tool.require.v1","id":"x","resolver":"absolute","programAbs":"/bin/true","extra":1}`,
		`{"kind":"gosh.tool.require.v1","id":"x","resolver":"absolute","programAbs":"/bin/true","rev":2}
{"kind":"gosh.tool.remove.v1","id":"x","rev":2}`,
		`{"kind":"gosh.tool.require.v1","id":"x","resolver":"absolute","programAbs":"/bin/true"}
{"kind":"gosh.tool.require.v1","id":"x","resolver":"bogus"}`,
	}
	for _, src := range cases {
		if _, err := LoadState(strings.NewReader(src)); err == nil {
			t.Fatalf("expected failure for %s", src)
		}
	}
}
func TestReplayDeterministic(t *testing.T) {
	src := `{"kind":"gosh.tool.require.v1","id":"x","resolver":"absolute","programAbs":"/bin/true"}
{"kind":"gosh.target.upsert.v1","id":"app","targetKind":"exec","tool":"x"}
`
	a, err := LoadState(strings.NewReader(src))
	if err != nil {
		t.Fatal(err)
	}
	b, err := LoadState(strings.NewReader(src))
	if err != nil {
		t.Fatal(err)
	}
	pa, _ := BuildPlan(a, "app")
	pb, _ := BuildPlan(b, "app")
	if pa.PlanSHA != pb.PlanSHA {
		t.Fatalf("nondeterministic %s %s", pa.PlanSHA, pb.PlanSHA)
	}
}

func TestTargetDeleteDoesNotResurrectOldMembers(t *testing.T) {
	src := `{"kind":"gosh.target.upsert.v1","id":"app","targetKind":"native.ensure-dir","path":"a"}
{"kind":"gosh.target.input.add.v1","target":"app","id":"old","path":"old"}
{"kind":"gosh.target.delete.v1","id":"app"}
{"kind":"gosh.target.upsert.v1","id":"app","targetKind":"native.ensure-dir","path":"b"}
`
	state, err := LoadState(strings.NewReader(src))
	if err != nil {
		t.Fatal(err)
	}
	if len(state.Targets["app"].Inputs) != 0 {
		t.Fatalf("deleted target resurrected old members %#v", state.Targets["app"].Inputs)
	}
}

func TestKnownButIrrelevantFieldsFailClosed(t *testing.T) {
	src := `{"kind":"gosh.tool.remove.v1","id":"x","args":["hidden"]}`
	if _, err := LoadState(strings.NewReader(src)); err == nil {
		t.Fatal("irrelevant known field accepted")
	}
}
