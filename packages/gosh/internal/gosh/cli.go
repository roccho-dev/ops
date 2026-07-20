package gosh

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

type CLI struct{ Stdout, Stderr *os.File }
type cliConfig struct {
	root, nixBin, goBin string
	capture             int
}

func (c CLI) Run(ctx context.Context, args []string) int {
	cfg, rest, err := parseGlobals(args)
	if err != nil {
		return c.fail("cli_misuse", err, 2)
	}
	if len(rest) == 0 {
		return c.fail("cli_misuse", errors.New("command required"), 2)
	}
	cmd, rest := rest[0], rest[1:]
	switch cmd {
	case "init":
		if len(rest) != 0 {
			return c.fail("cli_misuse", errors.New("init takes no arguments"), 2)
		}
		if err := Init(cfg.root); err != nil {
			return c.fail("init_failed", err, 1)
		}
		return c.ok("gosh.init.v1", Paths(cfg.root))
	case "tool":
		return c.tool(cfg, rest)
	case "target":
		return c.target(cfg, rest)
	case "check":
		return c.check(cfg, rest)
	case "list":
		return c.list(cfg, rest)
	case "plan":
		return c.plan(cfg, rest)
	case "run":
		return c.run(ctx, cfg, rest)
	case "snippet":
		return c.snippet(ctx, cfg, rest)
	case "version":
		return c.ok("gosh.version.v1", map[string]string{"version": "v0"})
	default:
		return c.fail("cli_misuse", fmt.Errorf("unknown command %q", cmd), 2)
	}
}
func parseGlobals(args []string) (cliConfig, []string, error) {
	cwd, _ := os.Getwd()
	cfg := cliConfig{root: cwd, capture: 64 * 1024}
	i := 0
	for i < len(args) {
		if !strings.HasPrefix(args[i], "--") {
			break
		}
		if i+1 >= len(args) {
			return cfg, nil, fmt.Errorf("%s requires value", args[i])
		}
		v := args[i+1]
		switch args[i] {
		case "--root":
			a, err := filepath.Abs(v)
			if err != nil {
				return cfg, nil, err
			}
			cfg.root = a
		case "--nix-bin":
			cfg.nixBin = v
		case "--go-bin":
			cfg.goBin = v
		case "--capture-limit":
			n, err := strconv.Atoi(v)
			if err != nil || n < 1 {
				return cfg, nil, errors.New("capture limit must be positive")
			}
			cfg.capture = n
		default:
			return cfg, nil, fmt.Errorf("unknown global option %s", args[i])
		}
		i += 2
	}
	return cfg, args[i:], nil
}
func (c CLI) tool(cfg cliConfig, a []string) int {
	if len(a) < 2 {
		return c.fail("cli_misuse", errors.New("tool require/remove <id>"), 2)
	}
	op, id := a[0], a[1]
	switch op {
	case "remove":
		if len(a) != 2 {
			return c.fail("cli_misuse", errors.New("tool remove <id>"), 2)
		}
		return c.append(cfg, Event{Kind: "gosh.tool.remove.v1", ID: id})
	case "require":
		f, err := kvFlags(a[2:])
		if err != nil {
			return c.fail("cli_misuse", err, 2)
		}
		ev := Event{Kind: "gosh.tool.require.v1", ID: id, Resolver: f.one("--resolver"), Installable: f.one("--installable"), ProgramRel: f.one("--program"), ProgramAbs: f.one("--program-abs")}
		if err = validateEvent(ev); err != nil {
			return c.fail("invalid_event", err, 1)
		}
		return c.append(cfg, ev)
	default:
		return c.fail("cli_misuse", fmt.Errorf("unknown tool operation %s", op), 2)
	}
}
func (c CLI) target(cfg cliConfig, a []string) int {
	if len(a) < 2 {
		return c.fail("cli_misuse", errors.New("target operation and id required"), 2)
	}
	op := a[0]
	if op == "input" || op == "output" || op == "env" {
		return c.targetMember(cfg, a)
	}
	id := a[1]
	switch op {
	case "delete":
		if len(a) != 2 {
			return c.fail("cli_misuse", errors.New("target delete <id>"), 2)
		}
		return c.append(cfg, Event{Kind: "gosh.target.delete.v1", ID: id})
	case "upsert":
		f, err := kvFlags(a[2:])
		if err != nil {
			return c.fail("cli_misuse", err, 2)
		}
		var args []string
		var stages []StageSpec
		if s := f.one("--args-json"); s != "" {
			if err = json.Unmarshal([]byte(s), &args); err != nil {
				return c.fail("cli_misuse", fmt.Errorf("args JSON: %w", err), 2)
			}
		}
		if s := f.one("--stages-json"); s != "" {
			if err = json.Unmarshal([]byte(s), &stages); err != nil {
				return c.fail("cli_misuse", fmt.Errorf("stages JSON: %w", err), 2)
			}
		}
		ev := Event{Kind: "gosh.target.upsert.v1", ID: id, TargetKind: f.one("--kind"), Tool: f.one("--tool"), Main: f.one("--main"), Path: f.one("--path"), Value: f.one("--value"), Mode: f.one("--mode"), Args: args, Stages: stages}
		if err = validateEvent(ev); err != nil {
			return c.fail("invalid_event", err, 1)
		}
		return c.append(cfg, ev)
	default:
		return c.fail("cli_misuse", fmt.Errorf("unknown target operation %s", op), 2)
	}
}
func (c CLI) targetMember(cfg cliConfig, a []string) int {
	area := a[0]
	if len(a) < 4 {
		return c.fail("cli_misuse", fmt.Errorf("target %s operation target id/key required", area), 2)
	}
	op, target, id := a[1], a[2], a[3]
	switch area + ":" + op {
	case "input:add":
		if len(a) != 5 {
			return c.fail("cli_misuse", errors.New("target input add <target> <id> <path>"), 2)
		}
		return c.append(cfg, Event{Kind: "gosh.target.input.add.v1", Target: target, ID: id, Path: a[4]})
	case "input:remove":
		if len(a) != 4 {
			return c.fail("cli_misuse", errors.New("target input remove <target> <id>"), 2)
		}
		return c.append(cfg, Event{Kind: "gosh.target.input.remove.v1", Target: target, ID: id})
	case "output:set":
		if len(a) != 5 {
			return c.fail("cli_misuse", errors.New("target output set <target> <id> <path>"), 2)
		}
		return c.append(cfg, Event{Kind: "gosh.target.output.set.v1", Target: target, ID: id, Path: a[4]})
	case "output:remove":
		if len(a) != 4 {
			return c.fail("cli_misuse", errors.New("target output remove <target> <id>"), 2)
		}
		return c.append(cfg, Event{Kind: "gosh.target.output.remove.v1", Target: target, ID: id})
	case "env:set":
		if len(a) != 5 {
			return c.fail("cli_misuse", errors.New("target env set <target> <key> <value>"), 2)
		}
		return c.append(cfg, Event{Kind: "gosh.target.env.set.v1", Target: target, Key: id, Value: a[4]})
	case "env:remove":
		if len(a) != 4 {
			return c.fail("cli_misuse", errors.New("target env remove <target> <key>"), 2)
		}
		return c.append(cfg, Event{Kind: "gosh.target.env.remove.v1", Target: target, Key: id})
	default:
		return c.fail("cli_misuse", fmt.Errorf("unknown target %s operation %s", area, op), 2)
	}
}
func (c CLI) check(cfg cliConfig, a []string) int {
	if len(a) < 2 {
		return c.fail("cli_misuse", errors.New("check upsert/delete <id>"), 2)
	}
	op, id := a[0], a[1]
	if op == "delete" {
		if len(a) != 2 {
			return c.fail("cli_misuse", errors.New("check delete <id>"), 2)
		}
		return c.append(cfg, Event{Kind: "gosh.check.delete.v1", ID: id})
	}
	if op != "upsert" {
		return c.fail("cli_misuse", errors.New("unknown check operation"), 2)
	}
	f, err := kvFlags(a[2:])
	if err != nil {
		return c.fail("cli_misuse", err, 2)
	}
	var args []string
	if s := f.one("--args-json"); s != "" {
		if err = json.Unmarshal([]byte(s), &args); err != nil {
			return c.fail("cli_misuse", err, 2)
		}
	}
	ev := Event{Kind: "gosh.check.upsert.v1", ID: id, Target: f.one("--target"), Tool: f.one("--tool"), Args: args}
	if err = validateEvent(ev); err != nil {
		return c.fail("invalid_event", err, 1)
	}
	return c.append(cfg, ev)
}
func (c CLI) list(cfg cliConfig, a []string) int {
	if len(a) != 1 {
		return c.fail("cli_misuse", errors.New("list tools|targets|checks"), 2)
	}
	s, err := LoadRoot(cfg.root)
	if err != nil {
		return c.fail("load_failed", err, 1)
	}
	switch a[0] {
	case "tools":
		v := []Tool{}
		for _, id := range SortedToolIDs(s) {
			v = append(v, s.Tools[id])
		}
		return c.ok("gosh.tools.v1", v)
	case "targets":
		v := []Target{}
		for _, id := range SortedTargetIDs(s) {
			v = append(v, s.Targets[id])
		}
		return c.ok("gosh.targets.v1", v)
	case "checks":
		v := []Check{}
		for _, id := range SortedCheckIDs(s) {
			v = append(v, s.Checks[id])
		}
		return c.ok("gosh.checks.v1", v)
	default:
		return c.fail("cli_misuse", errors.New("unknown list kind"), 2)
	}
}
func (c CLI) plan(cfg cliConfig, a []string) int {
	if len(a) != 1 {
		return c.fail("cli_misuse", errors.New("plan <target-or-check>"), 2)
	}
	s, err := LoadRoot(cfg.root)
	if err != nil {
		return c.fail("load_failed", err, 1)
	}
	p, err := BuildPlan(s, a[0])
	if err != nil {
		return c.fail("plan_failed", err, 1)
	}
	return c.ok("gosh.plan.v1", p)
}
func (c CLI) run(ctx context.Context, cfg cliConfig, a []string) int {
	if len(a) != 1 {
		return c.fail("cli_misuse", errors.New("run <target-or-check>"), 2)
	}
	s, err := LoadRoot(cfg.root)
	if err != nil {
		return c.fail("load_failed", err, 1)
	}
	p, err := BuildPlan(s, a[0])
	if err != nil {
		return c.fail("plan_failed", err, 1)
	}
	res := Resolver{}
	if cfg.nixBin != "" {
		res.Nix = nixCommandResolver{bin: cfg.nixBin}
	}
	r, err := Execute(ctx, s, p, res, RunOptions{CaptureLimit: cfg.capture, WorkingDir: cfg.root, ResultPath: Paths(cfg.root).Results, BaseEnv: essentialEnv()})
	if err != nil {
		return c.failData("run_failed", err, r, 1)
	}
	return c.ok("gosh.run.v1", r)
}
func (c CLI) snippet(ctx context.Context, cfg cliConfig, a []string) int {
	if len(a) < 2 {
		return c.fail("cli_misuse", errors.New("snippet build/run <source>"), 2)
	}
	op := a[0]
	sourcePath, err := localPath(cfg.root, a[1])
	if err != nil {
		return c.fail("snippet_read_failed", err, 1)
	}
	source, err := os.ReadFile(sourcePath)
	if err != nil {
		return c.fail("snippet_read_failed", err, 1)
	}
	if cfg.goBin == "" || !filepath.IsAbs(cfg.goBin) {
		return c.fail("cli_misuse", errors.New("--go-bin absolute path required"), 2)
	}
	buildEnv := essentialEnv()
	buildEnv["GOCACHE"] = filepath.Join(cfg.root, ".gosh", "cache", "go-build")
	build, err := BuildSnippet(ctx, source, SnippetOptions{Root: cfg.root, GoAbs: cfg.goBin, Env: buildEnv})
	if err != nil {
		return c.failData("snippet_build_failed", err, build, 1)
	}
	if op == "build" {
		if len(a) != 2 {
			return c.fail("cli_misuse", errors.New("snippet build <source>"), 2)
		}
		return c.ok("gosh.snippet.build.v1", build)
	}
	if op != "run" {
		return c.fail("cli_misuse", errors.New("unknown snippet operation"), 2)
	}
	runArgs := a[2:]
	if len(runArgs) > 0 && runArgs[0] == "--" {
		runArgs = runArgs[1:]
	}
	started := time.Now().UTC()
	stage, runErr := RunSnippet(ctx, build, runArgs, cfg.capture, essentialEnv())
	status := "succeeded"
	errorCode := ""
	diagnostic := ""
	if runErr != nil {
		status = "failed"
		errorCode = "snippet_run_failed"
		diagnostic = runErr.Error()
	}
	sourceHash := sha256.Sum256(source)
	audit := RunResult{
		Kind: "gosh.run.result.v1", Version: ResultVersion, ResultID: randomID(), RunID: randomID(),
		StartedAt: started, FinishedAt: time.Now().UTC(), Requested: "snippet:" + sourcePath,
		InputSHA: hex.EncodeToString(sourceHash[:]), Platform: runtime.GOOS, Architecture: runtime.GOARCH,
		Stages: []StageResult{stage}, EnvKeys: SafeEnvKeys(essentialEnv()), Status: status,
		ErrorCode: errorCode, Diagnostic: diagnostic,
		Cleanup:  "direct-children-context-cancelled; descendant-tree-not-claimed",
		Metadata: map[string]string{"cacheKey": build.CacheKey, "cacheHit": strconv.FormatBool(build.CacheHit), "toolIdentity": build.ToolIdentity},
	}
	audit.DurationMS = audit.FinishedAt.Sub(audit.StartedAt).Milliseconds()
	if err := AppendResult(Paths(cfg.root).Results, audit); err != nil {
		return c.failData("audit_append_failed", err, map[string]any{"build": build, "run": stage}, 1)
	}
	result := map[string]any{"build": build, "run": stage, "audit": audit}
	if runErr != nil {
		return c.failData("snippet_run_failed", runErr, result, 1)
	}
	return c.ok("gosh.snippet.run.v1", result)
}
func (c CLI) append(cfg cliConfig, ev Event) int {
	if err := validateEvent(ev); err != nil {
		return c.fail("invalid_event", err, 1)
	}
	if err := Init(cfg.root); err != nil {
		return c.fail("init_failed", err, 1)
	}
	if err := AppendEvent(Paths(cfg.root).Events, ev); err != nil {
		return c.fail("append_failed", err, 1)
	}
	if ev.Kind == "gosh.target.env.set.v1" {
		return c.ok("gosh.event.appended.v1", map[string]any{"kind": ev.Kind, "target": ev.Target, "key": ev.Key, "value": "<redacted>"})
	}
	return c.ok("gosh.event.appended.v1", ev)
}
func (c CLI) ok(kind string, v any) int {
	b, _ := json.Marshal(v)
	out := CommandOutput{OK: true, Kind: kind, Data: b}
	enc := json.NewEncoder(c.Stdout)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(out)
	return 0
}
func (c CLI) fail(code string, err error, status int) int { return c.failData(code, err, nil, status) }
func (c CLI) failData(code string, err error, v any, status int) int {
	var b json.RawMessage
	if v != nil {
		b, _ = json.Marshal(v)
	}
	out := CommandOutput{OK: false, Kind: "gosh.error.v1", Code: code, Error: err.Error(), Data: b}
	enc := json.NewEncoder(c.Stderr)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(out)
	return status
}

type flags map[string][]string

func (f flags) one(k string) string {
	v := f[k]
	if len(v) == 0 {
		return ""
	}
	return v[len(v)-1]
}
func kvFlags(a []string) (flags, error) {
	f := flags{}
	for i := 0; i < len(a); i += 2 {
		if !strings.HasPrefix(a[i], "--") || i+1 >= len(a) {
			return nil, fmt.Errorf("flag/value pairs required near %q", a[i])
		}
		f[a[i]] = append(f[a[i]], a[i+1])
	}
	return f, nil
}

type nixCommandResolver struct{ bin string }

func (n nixCommandResolver) Resolve(ctx context.Context, installable string) ([]string, error) {
	if !filepath.IsAbs(n.bin) {
		return nil, errors.New("nix binary must be absolute")
	}
	cmd := exec.CommandContext(ctx, n.bin, "build", "--no-link", "--print-out-paths", installable)
	cmd.Env = envSlice(essentialEnv())
	b, err := cmd.Output()
	if err != nil {
		return nil, err
	}
	return strings.Fields(string(b)), nil
}
func essentialEnv() map[string]string {
	m := map[string]string{}
	for _, k := range []string{"HOME", "TMPDIR", "TEMP", "TMP", "SYSTEMROOT", "WINDIR"} {
		if v := os.Getenv(k); v != "" {
			m[k] = v
		}
	}
	return m
}
func RunMain(args []string) int {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	return (CLI{Stdout: os.Stdout, Stderr: os.Stderr}).Run(ctx, args)
}

var _ = time.Second
