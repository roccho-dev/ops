package gosh

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func goExecutable(t *testing.T) string {
	name := "go"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	path := filepath.Join(runtime.GOROOT(), "bin", name)
	if _, err := os.Stat(path); err != nil {
		t.Skipf("Go executable unavailable: %v", err)
	}
	return path
}

func snippetEnv(t *testing.T) map[string]string {
	home := t.TempDir()
	return map[string]string{
		"HOME":        home,
		"GOCACHE":     filepath.Join(home, "cache"),
		"CGO_ENABLED": "0",
	}
}

func TestSnippetBuildCacheRunAndFailure(t *testing.T) {
	root := t.TempDir()
	env := snippetEnv(t)
	source := []byte("package main\nimport \"fmt\"\nfunc main(){fmt.Print(\"ok\")}\n")
	first, err := BuildSnippet(context.Background(), source, SnippetOptions{Root: root, GoAbs: goExecutable(t), Env: env})
	if err != nil {
		t.Fatal(err)
	}
	if first.CacheHit || first.CacheKey == "" {
		t.Fatalf("unexpected first build %#v", first)
	}
	second, err := BuildSnippet(context.Background(), source, SnippetOptions{Root: root, GoAbs: goExecutable(t), Env: env})
	if err != nil {
		t.Fatal(err)
	}
	if !second.CacheHit || second.CacheKey != first.CacheKey {
		t.Fatalf("cache miss %#v %#v", first, second)
	}
	stage, err := RunSnippet(context.Background(), second, nil, 32, env)
	if err != nil {
		t.Fatal(err)
	}
	if stage.Stdout.Captured != "ok" || stage.Status != "succeeded" {
		t.Fatalf("bad snippet result %#v", stage)
	}

	changedEnv := cloneMap(env)
	changedEnv["EXPLICIT_INPUT"] = "changed"
	third, err := BuildSnippet(context.Background(), source, SnippetOptions{Root: root, GoAbs: goExecutable(t), Env: changedEnv})
	if err != nil {
		t.Fatal(err)
	}
	if third.CacheKey == first.CacheKey {
		t.Fatal("allowed environment change did not change cache key")
	}

	bad, err := BuildSnippet(context.Background(), []byte("package main\nfunc main(\n"), SnippetOptions{Root: root, GoAbs: goExecutable(t), Env: env})
	if err == nil || !strings.Contains(err.Error(), "snippet build") {
		t.Fatalf("expected failed build, got %#v %v", bad, err)
	}
	if bad.Executable != "" {
		if _, statErr := os.Stat(bad.Executable); statErr == nil {
			t.Fatal("failed build left executable cache hit")
		}
	}
}
