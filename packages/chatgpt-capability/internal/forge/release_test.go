package forge

import (
	"archive/zip"
	"bytes"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestReleaseArtifactNamesDefaultContract(t *testing.T) {
	bundle, dist, err := ReleaseArtifactNames("260816235959", DefaultReleaseID)
	if err != nil {
		t.Fatal(err)
	}
	if bundle != "260816235959.6a819b1d-0d40-83e8-855a-00e20dd48e56.bundle" {
		t.Fatalf("bundle=%q", bundle)
	}
	if dist != "260816235959.6a819b1d-0d40-83e8-855a-00e20dd48e56.dist.zip" {
		t.Fatalf("dist=%q", dist)
	}
	for _, invalid := range []string{"", "260816-235959", "260816246000", "abcdefghijkl"} {
		if _, _, err := ReleaseArtifactNames(invalid, DefaultReleaseID); err == nil {
			t.Fatalf("accepted invalid timestamp %q", invalid)
		}
	}
}

func TestCreateReleaseSyntheticSourceIsDeterministic(t *testing.T) {
	parent := t.TempDir()
	root := filepath.Join(parent, "root")
	dist := filepath.Join(root, "dist")
	mustWriteTestFile(t, filepath.Join(root, "README.md"), []byte("source\n"), 0o644)
	mustWriteTestFile(t, filepath.Join(dist, "index.html"), []byte("<!doctype html>\n"), 0o644)
	mustWriteTestFile(t, filepath.Join(dist, "tool"), []byte("binary\n"), 0o755)

	first, err := CreateRelease(ReleaseOptions{Root: root, Dist: dist, OutDir: filepath.Join(parent, "out-a"), Timestamp: "260816120000"})
	if err != nil {
		t.Fatal(err)
	}
	second, err := CreateRelease(ReleaseOptions{Root: root, Dist: dist, OutDir: filepath.Join(parent, "out-b"), Timestamp: "260816120000"})
	if err != nil {
		t.Fatal(err)
	}
	if first.Status != "PASS" || first.GitMode != "synthetic-snapshot" {
		t.Fatalf("unexpected first receipt: %+v", first)
	}
	if first.BundleSHA256 != second.BundleSHA256 || first.DistZipSHA256 != second.DistZipSHA256 {
		t.Fatalf("release is not deterministic:\nfirst=%+v\nsecond=%+v", first, second)
	}
	bundlePath := filepath.Join(parent, "out-a", first.Bundle)
	cmd := exec.Command("git", "bundle", "verify", bundlePath)
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("bundle verify: %v: %s", err, output)
	}
	assertZipEntry(t, filepath.Join(parent, "out-a", first.DistZip), "index.html", []byte("<!doctype html>\n"))
}

func TestCreateReleaseUsesCleanRepositoryHistory(t *testing.T) {
	parent := t.TempDir()
	root := filepath.Join(parent, "root")
	dist := filepath.Join(root, "dist")
	mustWriteTestFile(t, filepath.Join(root, ".gitignore"), []byte("/dist/\n/*.bundle\n/*.dist.zip\n"), 0o644)
	mustWriteTestFile(t, filepath.Join(root, "README.md"), []byte("tracked\n"), 0o644)
	mustWriteTestFile(t, filepath.Join(dist, "index.html"), []byte("dist\n"), 0o644)
	runGitTest(t, root, "init", "-q", "-b", "main")
	runGitTest(t, root, "config", "user.name", "test")
	runGitTest(t, root, "config", "user.email", "test@example.invalid")
	runGitTest(t, root, "add", ".gitignore", "README.md")
	cmd := exec.Command("git", "commit", "-q", "-m", "base")
	cmd.Dir = root
	cmd.Env = append(os.Environ(), "GIT_AUTHOR_DATE=2026-08-16T12:00:00+09:00", "GIT_COMMITTER_DATE=2026-08-16T12:00:00+09:00")
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git commit: %v: %s", err, output)
	}
	head := runGitTest(t, root, "rev-parse", "HEAD")

	receipt, err := CreateRelease(ReleaseOptions{Root: root, Dist: dist, OutDir: root, Timestamp: "260816120001"})
	if err != nil {
		t.Fatal(err)
	}
	if receipt.GitMode != "repository" || receipt.GitHead != head {
		t.Fatalf("unexpected Git lineage: %+v want head=%s", receipt, head)
	}
	mustWriteTestFile(t, filepath.Join(root, "dirty.txt"), []byte("dirty"), 0o644)
	if _, err := CreateRelease(ReleaseOptions{Root: root, Dist: dist, OutDir: filepath.Join(parent, "other"), Timestamp: "260816120002"}); err == nil {
		t.Fatal("accepted dirty Git worktree")
	}
}

func mustWriteTestFile(t *testing.T, path string, data []byte, mode os.FileMode) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, mode); err != nil {
		t.Fatal(err)
	}
}

func runGitTest(t *testing.T, root string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = root
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v: %s", args, err, output)
	}
	return string(bytes.TrimSpace(output))
}

func assertZipEntry(t *testing.T, path, name string, expected []byte) {
	t.Helper()
	reader, err := zip.OpenReader(path)
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	for _, entry := range reader.File {
		if entry.Name != name {
			continue
		}
		stream, err := entry.Open()
		if err != nil {
			t.Fatal(err)
		}
		data, err := io.ReadAll(stream)
		closeErr := stream.Close()
		if err != nil {
			t.Fatal(err)
		}
		if closeErr != nil {
			t.Fatal(closeErr)
		}
		if !bytes.Equal(data, expected) {
			t.Fatalf("zip entry %s=%q want %q", name, data, expected)
		}
		return
	}
	t.Fatalf("zip entry missing: %s", name)
}
