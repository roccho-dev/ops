package gosh

import (
	"os"
	"path/filepath"
	"testing"
)

func TestInitCreatesOnlyCanonicalMinimalLayout(t *testing.T) {
	root := t.TempDir()
	if err := Init(root); err != nil {
		t.Fatal(err)
	}
	paths := Paths(root)
	for _, path := range []string{paths.Events, paths.Results, paths.Snippets} {
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("missing %s: %v", path, err)
		}
	}
	for _, absent := range []string{
		filepath.Join(paths.Dir, "state.reduced.json"),
		filepath.Join(paths.Dir, "state.resolved.json"),
		filepath.Join(paths.Dir, "plan.json"),
		paths.Bin,
	} {
		if _, err := os.Stat(absent); !os.IsNotExist(err) {
			t.Fatalf("derived path created by init: %s (%v)", absent, err)
		}
	}
}
