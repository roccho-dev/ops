package gosh

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestExecuteRunsPlannedDependenciesInOrder(t *testing.T) {
	root := t.TempDir()
	state := State{
		Tools: map[string]Tool{},
		Targets: map[string]Target{
			"produce": {
				ID: "produce", Kind: "native.write-file", Path: "dist/value.txt", Value: "value", SourceLine: 1,
				Inputs: map[string]Member{}, Outputs: map[string]Member{"out": {ID: "out", Value: "dist/value.txt", SourceLine: 2}}, Env: map[string]Member{},
			},
			"consume": {
				ID: "consume", Kind: "native.hash-file", Path: "dist/value.txt", SourceLine: 3,
				Inputs: map[string]Member{"in": {ID: "in", Value: "dist/value.txt", SourceLine: 4}}, Outputs: map[string]Member{}, Env: map[string]Member{},
			},
		},
		Checks: map[string]Check{}, InputSHA: "input",
	}
	plan, err := BuildPlan(state, "consume")
	if err != nil {
		t.Fatal(err)
	}
	result, err := Execute(context.Background(), state, plan, Resolver{}, RunOptions{WorkingDir: root})
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "succeeded" || !result.Changed || result.Metadata["sha256"] == "" {
		t.Fatalf("dependency result incomplete %#v", result)
	}
	if got, err := os.ReadFile(filepath.Join(root, "dist", "value.txt")); err != nil || string(got) != "value" {
		t.Fatalf("producer did not run first: %q %v", got, err)
	}
}

func TestAuditAppendFailureCannotReturnSuccess(t *testing.T) {
	root := t.TempDir()
	state := State{
		Tools: map[string]Tool{}, Checks: map[string]Check{}, InputSHA: "input",
		Targets: map[string]Target{"x": {ID: "x", Kind: "native.ensure-dir", Path: "created", SourceLine: 1, Inputs: map[string]Member{}, Outputs: map[string]Member{}, Env: map[string]Member{}}},
	}
	plan, err := BuildPlan(state, "x")
	if err != nil {
		t.Fatal(err)
	}
	result, err := Execute(context.Background(), state, plan, Resolver{}, RunOptions{WorkingDir: root, ResultPath: root})
	if err == nil || result.ErrorCode != "audit_append_failed" || result.Status != "failed" {
		t.Fatalf("false audited success %#v %v", result, err)
	}
}
