package architecture

import (
	"bufio"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestP14NoDotImportsInRuntimeCode(t *testing.T) {
	root := repoRoot(t)
	for _, dir := range []string{"cmd", "internal"} {
		err := filepath.WalkDir(filepath.Join(root, dir), func(path string, d os.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if d.IsDir() || !strings.HasSuffix(path, ".go") {
				return nil
			}
			data := string(mustReadFile(t, path))
			for _, line := range strings.Split(data, "\n") {
				if strings.HasPrefix(strings.TrimSpace(line), `. "`) {
					t.Fatalf("dot import is forbidden in runtime code: %s", relPath(t, root, path))
				}
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}
}

func TestP14CoreImplementationFilesAreSmallEnough(t *testing.T) {
	root := repoRoot(t)
	maxLines := 320
	for _, dir := range []string{"internal/core/validate", "internal/core/artifacts"} {
		err := filepath.WalkDir(filepath.Join(root, dir), func(path string, d os.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
				return nil
			}
			lines := countLines(t, path)
			if lines > maxLines {
				t.Fatalf("%s has %d lines; split core responsibilities below %d lines", relPath(t, root, path), lines, maxLines)
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}
}

func TestP14AppendOnlyGuardIsWired(t *testing.T) {
	root := repoRoot(t)
	main := read(t, root, "cmd/contractcheck/main.go")
	if !strings.Contains(main, "append-only-check") || !strings.Contains(main, "internal/core/appendonly") {
		t.Fatalf("cmd/contractcheck must expose append-only-check via internal/core/appendonly")
	}
	guard := read(t, root, "internal/core/appendonly/appendonly.go")
	for _, needle := range []string{"func Check", "previous_hash", "ledger_hash", "prefix_lines"} {
		if !strings.Contains(guard, needle) {
			t.Fatalf("append-only guard missing %s", needle)
		}
	}
}

func TestP14P10ScriptIsFullyAutomated(t *testing.T) {
	root := repoRoot(t)
	script := read(t, root, "scripts/test_p10_partition_snapshot_scale.sh")
	forbidden := []string{"gzip -dc", "after_timeout", "manual assertion", "manual_assertion"}
	for _, f := range forbidden {
		if strings.Contains(script, f) {
			t.Fatalf("P10 script still has manual/timeout workaround marker %q", f)
		}
	}
}

func countLines(t *testing.T, path string) int {
	t.Helper()
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	n := 0
	for sc.Scan() {
		n++
	}
	if err := sc.Err(); err != nil {
		t.Fatal(err)
	}
	return n
}

func mustReadFile(t *testing.T, path string) []byte {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func relPath(t *testing.T, root, path string) string {
	t.Helper()
	rel, err := filepath.Rel(root, path)
	if err != nil {
		t.Fatal(err)
	}
	return filepath.ToSlash(rel)
}
