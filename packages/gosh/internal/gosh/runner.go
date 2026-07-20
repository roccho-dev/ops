package gosh

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"
)

type RunOptions struct {
	CaptureLimit int
	WorkingDir   string
	ResultPath   string
	RunID        string
	BaseEnv      map[string]string
}

func Execute(ctx context.Context, s State, p Plan, resolver Resolver, opts RunOptions) (RunResult, error) {
	start := time.Now().UTC()
	if opts.CaptureLimit <= 0 {
		opts.CaptureLimit = 64 * 1024
	}
	if opts.RunID == "" {
		opts.RunID = randomID()
	}
	if !filepath.IsAbs(opts.WorkingDir) {
		return RunResult{}, fmt.Errorf("working directory must be absolute")
	}
	r := RunResult{
		Kind:         "gosh.run.result.v1",
		Version:      ResultVersion,
		ResultID:     randomID(),
		RunID:        opts.RunID,
		StartedAt:    start,
		Requested:    p.Requested,
		InputSHA:     p.InputSHA,
		PlanSHA:      p.PlanSHA,
		Platform:     runtime.GOOS,
		Architecture: runtime.GOARCH,
		Status:       "failed",
		Cleanup:      "direct-children-context-cancelled; descendant-tree-not-claimed",
		EnvKeys:      SafeEnvKeys(opts.BaseEnv),
	}

	resolved := map[string]ResolvedTool{}
	for _, step := range p.Steps {
		if step.Kind != "resolve.tool" {
			continue
		}
		tool := s.Tools[step.Tool]
		rt, err := resolver.Resolve(ctx, tool)
		if err != nil {
			return finishFailure(r, "resolve_failed", err, opts.ResultPath)
		}
		resolved[step.Tool] = rt
		r.ResolvedTools = append(r.ResolvedTools, rt)
	}
	sort.Slice(r.ResolvedTools, func(i, j int) bool { return r.ResolvedTools[i].ID < r.ResolvedTools[j].ID })

	for _, step := range p.Steps {
		var err error
		switch step.Kind {
		case "resolve.tool":
			continue
		case "run.target":
			t, ok := s.Targets[step.Target]
			if !ok || t.Deleted {
				err = fmt.Errorf("plan target %q is unavailable", step.Target)
			} else {
				_, err = runTarget(ctx, t, resolved, opts, &r)
			}
		case "run.check":
			c, ok := s.Checks[strings.TrimPrefix(step.ID, "check:")]
			if !ok || c.Deleted {
				err = fmt.Errorf("plan check %q is unavailable", step.ID)
			} else {
				stage := StageSpec{ID: "check:" + c.ID, Tool: c.Tool, Args: c.Args, Cwd: opts.WorkingDir}
				var stages []StageResult
				stages, err = runPipeline(ctx, []StageSpec{stage}, resolved, opts.CaptureLimit, opts.BaseEnv)
				r.Stages = append(r.Stages, stages...)
			}
		default:
			err = fmt.Errorf("unsupported plan step %q", step.Kind)
		}
		if err != nil {
			return finishFailure(r, "execution_failed", err, opts.ResultPath)
		}
	}

	r.Status = "succeeded"
	r.FinishedAt = time.Now().UTC()
	r.DurationMS = r.FinishedAt.Sub(r.StartedAt).Milliseconds()
	if opts.ResultPath != "" {
		if err := AppendResult(opts.ResultPath, r); err != nil {
			return finishFailureNoAppend(r, "audit_append_failed", err)
		}
	}
	return r, nil
}

func runTarget(ctx context.Context, t Target, resolved map[string]ResolvedTool, opts RunOptions, r *RunResult) (bool, error) {
	switch t.Kind {
	case "stdio.pipeline":
		stages, err := runPipeline(ctx, normalizeStages(t.Stages, opts.WorkingDir), resolved, opts.CaptureLimit, mergeEnv(opts.BaseEnv, targetEnv(t)))
		r.Stages = append(r.Stages, stages...)
		return false, err
	case "exec":
		stage := StageSpec{ID: "target:" + t.ID, Tool: t.Tool, Args: append([]string(nil), t.Args...), Cwd: opts.WorkingDir}
		stages, err := runPipeline(ctx, []StageSpec{stage}, resolved, opts.CaptureLimit, mergeEnv(opts.BaseEnv, targetEnv(t)))
		r.Stages = append(r.Stages, stages...)
		return false, err
	case "go.binary":
		stage := StageSpec{ID: "target:" + t.ID, Tool: t.Tool, Args: append([]string{t.Main}, t.Args...), Cwd: opts.WorkingDir}
		stages, err := runPipeline(ctx, []StageSpec{stage}, resolved, opts.CaptureLimit, mergeEnv(opts.BaseEnv, targetEnv(t)))
		r.Stages = append(r.Stages, stages...)
		return false, err
	case "native.ensure-dir":
		path, err := localPath(opts.WorkingDir, t.Path)
		if err != nil {
			return false, err
		}
		changed, err := EnsureDir(path)
		r.Changed = r.Changed || changed
		return changed, err
	case "native.write-file":
		path, err := localPath(opts.WorkingDir, t.Path)
		if err != nil {
			return false, err
		}
		changed, err := WriteFileVerified(path, []byte(t.Value), 0600)
		r.Changed = r.Changed || changed
		return changed, err
	case "native.hash-file":
		path, err := localPath(opts.WorkingDir, t.Path)
		if err != nil {
			return false, err
		}
		digest, err := HashFile(path)
		if r.Metadata == nil {
			r.Metadata = map[string]string{}
		}
		r.Metadata["sha256"] = digest
		return false, err
	default:
		return false, fmt.Errorf("unsupported target kind %q", t.Kind)
	}
}

type pipelineResources struct {
	input       *os.File
	output      *os.File
	outputTemp  string
	outputFinal string
}

func runPipeline(ctx context.Context, specs []StageSpec, resolved map[string]ResolvedTool, limit int, baseEnv map[string]string) ([]StageResult, error) {
	if len(specs) == 0 {
		return nil, errors.New("empty pipeline")
	}
	if limit <= 0 {
		return nil, errors.New("capture limit must be positive")
	}

	cmds := make([]*exec.Cmd, len(specs))
	cmdCtxs := make([]context.Context, len(specs))
	cancels := make([]context.CancelFunc, len(specs))
	stdoutW := make([]*evidenceWriter, len(specs))
	stderrW := make([]*evidenceWriter, len(specs))
	pipes := make([][2]*os.File, max(0, len(specs)-1))
	starts := make([]time.Time, len(specs))
	results := make([]StageResult, len(specs))
	resources := pipelineResources{}
	cleanup := func() {
		closePipes(pipes)
		if resources.input != nil {
			_ = resources.input.Close()
		}
		if resources.output != nil {
			_ = resources.output.Close()
		}
		if resources.outputTemp != "" {
			_ = os.Remove(resources.outputTemp)
		}
		for _, cancel := range cancels {
			if cancel != nil {
				cancel()
			}
		}
	}

	for i := range pipes {
		r, w, err := os.Pipe()
		if err != nil {
			cleanup()
			return nil, err
		}
		pipes[i] = [2]*os.File{r, w}
	}

	for i, spec := range specs {
		resolvedTool, ok := resolved[spec.Tool]
		if !ok {
			cleanup()
			return nil, fmt.Errorf("stage %d missing resolved tool %q", i, spec.Tool)
		}
		if !filepath.IsAbs(resolvedTool.ProgramAbs) {
			cleanup()
			return nil, fmt.Errorf("stage %d program not absolute", i)
		}
		if spec.Cwd == "" || !filepath.IsAbs(spec.Cwd) {
			cleanup()
			return nil, fmt.Errorf("stage %d cwd must be absolute", i)
		}
		if i > 0 && spec.Stdin != "" {
			cleanup()
			return nil, fmt.Errorf("stage %d stdin source is only valid on the first stage", i)
		}
		if i < len(specs)-1 && spec.Stdout != "" {
			cleanup()
			return nil, fmt.Errorf("stage %d stdout sink is only valid on the final stage", i)
		}

		stageCtx := ctx
		if spec.TimeoutMS > 0 {
			stageCtx, cancels[i] = context.WithTimeout(ctx, time.Duration(spec.TimeoutMS)*time.Millisecond)
		}
		cmdCtxs[i] = stageCtx
		cmd := exec.CommandContext(stageCtx, resolvedTool.ProgramAbs, spec.Args...)
		cmd.Dir = spec.Cwd
		cmd.Env = envSlice(mergeEnv(baseEnv, spec.Env))
		stdoutW[i] = newEvidenceWriter(limit)
		stderrW[i] = newEvidenceWriter(limit)
		cmd.Stderr = stderrW[i]

		if i == 0 && spec.Stdin != "" {
			input, err := os.Open(spec.Stdin)
			if err != nil {
				cleanup()
				return nil, fmt.Errorf("open stdin source: %w", err)
			}
			resources.input = input
			cmd.Stdin = input
		} else if i > 0 {
			cmd.Stdin = pipes[i-1][0]
		}

		if i < len(specs)-1 {
			cmd.Stdout = io.MultiWriter(pipes[i][1], stdoutW[i])
		} else if spec.Stdout != "" {
			if err := os.MkdirAll(filepath.Dir(spec.Stdout), 0755); err != nil {
				cleanup()
				return nil, fmt.Errorf("create stdout sink directory: %w", err)
			}
			output, err := os.CreateTemp(filepath.Dir(spec.Stdout), ".gosh-output-*")
			if err != nil {
				cleanup()
				return nil, fmt.Errorf("create stdout sink: %w", err)
			}
			resources.output = output
			resources.outputTemp = output.Name()
			resources.outputFinal = spec.Stdout
			cmd.Stdout = io.MultiWriter(output, stdoutW[i])
		} else {
			cmd.Stdout = stdoutW[i]
		}

		cmds[i] = cmd
		id := spec.ID
		if id == "" {
			id = fmt.Sprintf("stage-%d", i+1)
		}
		results[i] = StageResult{
			ID:         id,
			ProgramAbs: resolvedTool.ProgramAbs,
			Argv:       append([]string(nil), spec.Args...),
			Cwd:        spec.Cwd,
			EnvKeys:    SafeEnvKeys(mergeEnv(baseEnv, spec.Env)),
			ExitCode:   -1,
			Status:     "failed",
		}
	}

	started := make([]int, 0, len(cmds))
	for i := len(cmds) - 1; i >= 0; i-- {
		starts[i] = time.Now()
		if err := cmds[i].Start(); err != nil {
			closePipes(pipes)
			for _, j := range started {
				if cmds[j].Process != nil {
					_ = cmds[j].Process.Kill()
					_ = cmds[j].Wait()
				}
			}
			cleanup()
			return results, fmt.Errorf("start stage %d: %w", i, err)
		}
		results[i].Started = true
		started = append(started, i)
	}

	for _, pipe := range pipes {
		_ = pipe[0].Close()
	}
	if resources.input != nil {
		_ = resources.input.Close()
		resources.input = nil
	}

	var firstErr error
	for i := 0; i < len(cmds); i++ {
		err := cmds[i].Wait()
		if i < len(pipes) {
			_ = pipes[i][1].Close()
		}
		results[i].DurationMS = time.Since(starts[i]).Milliseconds()
		results[i].Stdout = stdoutW[i].Evidence()
		results[i].Stderr = stderrW[i].Evidence()
		if i == len(cmds)-1 && resources.outputFinal != "" {
			results[i].Stdout.Sink = resources.outputFinal
		}
		if err == nil {
			results[i].ExitCode = 0
			results[i].Status = "succeeded"
			continue
		}
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			results[i].ExitCode = exitErr.ExitCode()
		}
		if cmdCtxs[i] != nil && cmdCtxs[i].Err() != nil {
			results[i].Status = "cancelled"
		} else {
			results[i].Status = "failed"
		}
		if firstErr == nil {
			firstErr = fmt.Errorf("stage %d: %w", i, err)
		}
	}

	if resources.output != nil {
		if err := resources.output.Sync(); err != nil && firstErr == nil {
			firstErr = fmt.Errorf("sync stdout sink: %w", err)
		}
		if err := resources.output.Close(); err != nil && firstErr == nil {
			firstErr = fmt.Errorf("close stdout sink: %w", err)
		}
		resources.output = nil
	}
	if resources.outputTemp != "" {
		if firstErr == nil {
			if err := os.Rename(resources.outputTemp, resources.outputFinal); err != nil {
				firstErr = fmt.Errorf("publish stdout sink: %w", err)
			}
		}
		if firstErr != nil {
			_ = os.Remove(resources.outputTemp)
		}
		resources.outputTemp = ""
	}
	for _, cancel := range cancels {
		if cancel != nil {
			cancel()
		}
	}
	return results, firstErr
}

func closePipes(pipes [][2]*os.File) {
	for _, pipe := range pipes {
		if pipe[0] != nil {
			_ = pipe[0].Close()
		}
		if pipe[1] != nil {
			_ = pipe[1].Close()
		}
	}
}

func normalizeStages(in []StageSpec, root string) []StageSpec {
	out := append([]StageSpec(nil), in...)
	for i := range out {
		out[i].Args = append([]string(nil), out[i].Args...)
		out[i].Env = cloneMap(out[i].Env)
		if out[i].Cwd == "" {
			out[i].Cwd = root
		} else if !filepath.IsAbs(out[i].Cwd) {
			out[i].Cwd = filepath.Join(root, out[i].Cwd)
		}
		if out[i].Stdin != "" && !filepath.IsAbs(out[i].Stdin) {
			out[i].Stdin = filepath.Join(root, out[i].Stdin)
		}
		if out[i].Stdout != "" && !filepath.IsAbs(out[i].Stdout) {
			out[i].Stdout = filepath.Join(root, out[i].Stdout)
		}
	}
	return out
}

func localPath(root, path string) (string, error) {
	if strings.TrimSpace(path) == "" {
		return "", errors.New("path is required")
	}
	if !filepath.IsAbs(path) {
		path = filepath.Join(root, path)
	}
	return filepath.Abs(filepath.Clean(path))
}

func targetEnv(t Target) map[string]string {
	env := map[string]string{}
	for key, member := range t.Env {
		if !member.Deleted {
			env[key] = member.Value
		}
	}
	return env
}

func mergeEnv(a, b map[string]string) map[string]string {
	result := cloneMap(a)
	for key, value := range b {
		result[key] = value
	}
	return result
}

func cloneMap(in map[string]string) map[string]string {
	out := map[string]string{}
	for key, value := range in {
		out[key] = value
	}
	return out
}

func envSlice(env map[string]string) []string {
	keys := make([]string, 0, len(env))
	for key := range env {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	out := make([]string, 0, len(keys))
	for _, key := range keys {
		out = append(out, key+"="+env[key])
	}
	return out
}

func finishFailure(r RunResult, code string, err error, path string) (RunResult, error) {
	r = finishFailureNoAppendValue(r, code, err)
	if path != "" {
		if appendErr := AppendResult(path, r); appendErr != nil {
			return finishFailureNoAppend(r, "audit_append_failed", appendErr)
		}
	}
	return r, err
}

func finishFailureNoAppend(r RunResult, code string, err error) (RunResult, error) {
	return finishFailureNoAppendValue(r, code, err), err
}

func finishFailureNoAppendValue(r RunResult, code string, err error) RunResult {
	r.Status = "failed"
	r.ErrorCode = code
	r.Diagnostic = err.Error()
	r.FinishedAt = time.Now().UTC()
	r.DurationMS = r.FinishedAt.Sub(r.StartedAt).Milliseconds()
	return r
}

func randomID() string {
	bytes := make([]byte, 12)
	if _, err := rand.Read(bytes); err != nil {
		return fmt.Sprintf("time-%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(bytes)
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
