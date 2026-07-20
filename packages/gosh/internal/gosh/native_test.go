package gosh

import (
	"os"
	"path/filepath"
	"testing"
)

func TestNativeOperationsAreIdempotentAndVerified(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "nested")
	changed, err := EnsureDir(dir)
	if err != nil || !changed {
		t.Fatalf("first ensure: %v %v", changed, err)
	}
	changed, err = EnsureDir(dir)
	if err != nil || changed {
		t.Fatalf("second ensure: %v %v", changed, err)
	}
	path := filepath.Join(dir, "value.txt")
	changed, err = WriteFileVerified(path, []byte("value"), 0600)
	if err != nil || !changed {
		t.Fatalf("first write: %v %v", changed, err)
	}
	changed, err = WriteFileVerified(path, []byte("value"), 0600)
	if err != nil || changed {
		t.Fatalf("second write: %v %v", changed, err)
	}
	if digest, err := HashFile(path); err != nil || len(digest) != 64 {
		t.Fatalf("hash: %q %v", digest, err)
	}
	if mode := mustStat(t, path).Mode().Perm(); mode&0077 != 0 && os.Getuid() != -1 {
		t.Fatalf("unexpected file mode %o", mode)
	}
}

func mustStat(t *testing.T, path string) os.FileInfo {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	return info
}
