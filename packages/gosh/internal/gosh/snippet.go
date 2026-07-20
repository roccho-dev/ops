package gosh

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
)

type SnippetOptions struct {
	Root, GoAbs, ToolIdentity string
	BuildFlags                []string
	Env                       map[string]string
}
type SnippetBuild struct {
	CacheKey     string `json:"cacheKey"`
	Executable   string `json:"executable"`
	CacheHit     bool   `json:"cacheHit"`
	ToolIdentity string `json:"toolIdentity"`
}

func BuildSnippet(ctx context.Context, source []byte, o SnippetOptions) (SnippetBuild, error) {
	goAbs, err := validateExecutable(o.GoAbs)
	if err != nil {
		return SnippetBuild{}, err
	}
	if o.ToolIdentity == "" {
		cmd := exec.CommandContext(ctx, goAbs, "version")
		cmd.Env = envSlice(o.Env)
		b, e := cmd.Output()
		if e != nil {
			return SnippetBuild{}, fmt.Errorf("go identity: %w", e)
		}
		o.ToolIdentity = strings.TrimSpace(string(b))
	}
	environment := make([]string, 0, len(o.Env))
	for key, value := range o.Env {
		environment = append(environment, key+"="+value)
	}
	sort.Strings(environment)
	h := sha256.New()
	for _, part := range [][]byte{source, []byte("gosh-snippet-wrapper-v1"), []byte(o.ToolIdentity), []byte(runtime.GOOS), []byte(runtime.GOARCH), []byte(strings.Join(o.BuildFlags, "\x00")), []byte(strings.Join(environment, "\x00"))} {
		h.Write(part)
		h.Write([]byte{0})
	}
	key := hex.EncodeToString(h.Sum(nil))
	dir := filepath.Join(o.Root, ".gosh", "cache", "snippets", key)
	exe := filepath.Join(dir, "run")
	if runtime.GOOS == "windows" {
		exe += ".exe"
	}
	if _, e := validateExecutable(exe); e == nil {
		return SnippetBuild{CacheKey: key, Executable: exe, CacheHit: true, ToolIdentity: o.ToolIdentity}, nil
	}
	srcDir := filepath.Join(dir, "source")
	if err := os.MkdirAll(srcDir, 0700); err != nil {
		return SnippetBuild{}, err
	}
	src := filepath.Join(srcDir, "main.go")
	if err := os.WriteFile(src, source, 0600); err != nil {
		return SnippetBuild{}, err
	}
	tmpFile, err := os.CreateTemp(dir, ".run-build-*")
	if err != nil {
		return SnippetBuild{}, err
	}
	tmp := tmpFile.Name()
	if err := tmpFile.Close(); err != nil {
		_ = os.Remove(tmp)
		return SnippetBuild{}, err
	}
	_ = os.Remove(tmp)
	args := append([]string{"build", "-trimpath", "-o", tmp}, o.BuildFlags...)
	args = append(args, src)
	cmd := exec.CommandContext(ctx, goAbs, args...)
	cmd.Dir = srcDir
	cmd.Env = envSlice(o.Env)
	out, err := cmd.CombinedOutput()
	if err != nil {
		_ = os.Remove(tmp)
		return SnippetBuild{}, fmt.Errorf("snippet build: %w: %s", err, strings.TrimSpace(string(out)))
	}
	if _, err = validateExecutable(tmp); err != nil {
		_ = os.Remove(tmp)
		return SnippetBuild{}, err
	}
	if err = os.Rename(tmp, exe); err != nil {
		_ = os.Remove(tmp)
		return SnippetBuild{}, err
	}
	return SnippetBuild{CacheKey: key, Executable: exe, ToolIdentity: o.ToolIdentity}, nil
}
func RunSnippet(ctx context.Context, b SnippetBuild, args []string, limit int, env map[string]string) (StageResult, error) {
	rt := ResolvedTool{ID: "snippet", Backend: "snippet", ProgramAbs: b.Executable}
	res, err := runPipeline(ctx, []StageSpec{{ID: "snippet.run", Tool: "snippet", Args: args, Cwd: filepath.Dir(b.Executable)}}, map[string]ResolvedTool{"snippet": rt}, limit, env)
	if len(res) == 0 {
		return StageResult{}, err
	}
	return res[0], err
}
