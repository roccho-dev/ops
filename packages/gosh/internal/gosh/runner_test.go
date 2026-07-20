package gosh

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestHelperProcess(t *testing.T) {
	if os.Getenv("GO_WANT_HELPER_PROCESS") != "1" {
		return
	}
	args := os.Args
	idx := 0
	for i, a := range args {
		if a == "--" {
			idx = i + 1
			break
		}
	}
	switch args[idx] {
	case "cat":
		_, _ = io.Copy(os.Stdout, os.Stdin)
	case "upper":
		b, _ := io.ReadAll(os.Stdin)
		fmt.Fprint(os.Stdout, strings.ToUpper(string(b)))
	case "emit":
		fmt.Fprint(os.Stdout, args[idx+1])
	case "args":
		fmt.Fprint(os.Stdout, strings.Join(args[idx+1:], "\x1f"))
	case "binary":
		_, _ = os.Stdout.Write([]byte{0, 1, 2, 255})
	case "stderr":
		for i := 0; i < 20000; i++ {
			fmt.Fprint(os.Stderr, "err")
		}
		fmt.Fprint(os.Stdout, "ok")
	case "fail":
		fmt.Fprint(os.Stderr, "bad")
		os.Exit(7)
	case "sleep":
		time.Sleep(5 * time.Second)
	}
	os.Exit(0)
}
func helperTool(t *testing.T) ResolvedTool {
	p, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	return ResolvedTool{ID: "h", Backend: "absolute", ProgramAbs: p}
}
func helperStage(cwd, id, op string, extra ...string) StageSpec {
	return StageSpec{ID: id, Tool: "h", Args: append([]string{"-test.run=TestHelperProcess", "--", op}, extra...), Cwd: cwd}
}
func TestPipelineBinaryStderrAndAllStageEvidence(t *testing.T) {
	env := map[string]string{"GO_WANT_HELPER_PROCESS": "1"}
	cwd := t.TempDir()
	res, err := runPipeline(context.Background(), []StageSpec{helperStage(cwd, "a", "emit", "abc"), helperStage(cwd, "b", "upper")}, map[string]ResolvedTool{"h": helperTool(t)}, 1024, env)
	if err != nil {
		t.Fatal(err)
	}
	if len(res) != 2 || res[1].Stdout.Captured != "ABC" || res[0].Stdout.SHA256 == "" {
		t.Fatalf("bad results %#v", res)
	}
	res, err = runPipeline(context.Background(), []StageSpec{helperStage(cwd, "s", "stderr")}, map[string]ResolvedTool{"h": helperTool(t)}, 32, env)
	if err != nil {
		t.Fatal(err)
	}
	if !res[0].Stderr.Truncated || res[0].Stdout.Captured != "ok" {
		t.Fatalf("bounded evidence missing %#v", res[0])
	}
}
func TestPipelineHostileArgvFileSourceAndAtomicSink(t *testing.T) {
	env := map[string]string{"GO_WANT_HELPER_PROCESS": "1"}
	cwd := t.TempDir()
	hostile := []string{"space value", `"quoted"`, "$(not-run)", "a;b", "*.txt"}
	stage := helperStage(cwd, "argv", "args", hostile...)
	result, err := runPipeline(context.Background(), []StageSpec{stage}, map[string]ResolvedTool{"h": helperTool(t)}, 4096, env)
	if err != nil {
		t.Fatal(err)
	}
	if result[0].Stdout.Captured != strings.Join(hostile, "\x1f") {
		t.Fatalf("argv boundary changed: %q", result[0].Stdout.Captured)
	}

	input := filepath.Join(cwd, "input.bin")
	output := filepath.Join(cwd, "output.bin")
	payload := []byte{0, 1, 2, 3, 255}
	if err := os.WriteFile(input, payload, 0600); err != nil {
		t.Fatal(err)
	}
	cat := helperStage(cwd, "cat", "cat")
	cat.Stdin = input
	cat.Stdout = output
	result, err = runPipeline(context.Background(), []StageSpec{cat}, map[string]ResolvedTool{"h": helperTool(t)}, 2, env)
	if err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(output)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(payload) || result[0].Stdout.Bytes != int64(len(payload)) || !result[0].Stdout.Truncated || result[0].Stdout.Sink != output {
		t.Fatalf("sink evidence mismatch %#v %v", result[0], got)
	}

	failedOutput := filepath.Join(cwd, "failed.bin")
	fail := helperStage(cwd, "fail", "fail")
	fail.Stdout = failedOutput
	if _, err := runPipeline(context.Background(), []StageSpec{fail}, map[string]ResolvedTool{"h": helperTool(t)}, 32, env); err == nil {
		t.Fatal("expected failed sink run")
	}
	if _, err := os.Stat(failedOutput); !os.IsNotExist(err) {
		t.Fatalf("failed pipeline published sink: %v", err)
	}
}

func TestPipelineBinaryEvidence(t *testing.T) {
	env := map[string]string{"GO_WANT_HELPER_PROCESS": "1"}
	cwd := t.TempDir()
	result, err := runPipeline(context.Background(), []StageSpec{helperStage(cwd, "binary", "binary")}, map[string]ResolvedTool{"h": helperTool(t)}, 2, env)
	if err != nil {
		t.Fatal(err)
	}
	if result[0].Stdout.Bytes != 4 || !result[0].Stdout.Truncated || result[0].Stdout.SHA256 == "" {
		t.Fatalf("binary evidence missing %#v", result[0].Stdout)
	}
}

func TestPipelineFailureAndCancellation(t *testing.T) {
	env := map[string]string{"GO_WANT_HELPER_PROCESS": "1"}
	cwd := t.TempDir()
	res, err := runPipeline(context.Background(), []StageSpec{helperStage(cwd, "f", "fail")}, map[string]ResolvedTool{"h": helperTool(t)}, 1024, env)
	if err == nil || res[0].ExitCode != 7 {
		t.Fatalf("expected stage failure %#v %v", res, err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	res, err = runPipeline(ctx, []StageSpec{helperStage(cwd, "c", "sleep")}, map[string]ResolvedTool{"h": helperTool(t)}, 1024, env)
	if err == nil || res[0].Status != "cancelled" {
		t.Fatalf("expected cancellation %#v %v", res, err)
	}
	_ = runtime.GOOS
}
