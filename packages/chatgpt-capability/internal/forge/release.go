package forge

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const (
	DefaultReleaseID       = "6a819b1d-0d40-83e8-855a-00e20dd48e56"
	ReleaseTimestampLayout = "060102150405"
)

var releaseJST = time.FixedZone("JST", 9*60*60)

type ReleaseNaming struct {
	ID              string `json:"id"`
	Timezone        string `json:"timezone"`
	TimestampFormat string `json:"timestampFormat"`
	BundlePattern   string `json:"bundlePattern"`
	DistZipPattern  string `json:"distZipPattern"`
	BundleFormat    string `json:"bundleFormat"`
	DistZipFormat   string `json:"distZipFormat"`
}

type ReleaseOptions struct {
	Root      string
	Dist      string
	OutDir    string
	ID        string
	Timestamp string
}

type ReleaseReceipt struct {
	Schema        string `json:"schema"`
	Status        string `json:"status"`
	TimestampJST  string `json:"timestampJst"`
	ID            string `json:"id"`
	GitHead       string `json:"gitHead"`
	GitMode       string `json:"gitMode"`
	Bundle        string `json:"bundle"`
	BundleBytes   int64  `json:"bundleBytes"`
	BundleSHA256  string `json:"bundleSha256"`
	DistZip       string `json:"distZip"`
	DistZipBytes  int64  `json:"distZipBytes"`
	DistZipSHA256 string `json:"distZipSha256"`
}

type proofEntry struct {
	Path   string `json:"path"`
	Bytes  int64  `json:"bytes"`
	SHA256 string `json:"sha256"`
}

type proofManifest struct {
	Schema string       `json:"schema"`
	Status string       `json:"status"`
	Files  []proofEntry `json:"files"`
}

func DefaultReleaseNaming() ReleaseNaming {
	return ReleaseNaming{
		ID:              DefaultReleaseID,
		Timezone:        "Asia/Tokyo",
		TimestampFormat: "yymmddhhmmss",
		BundlePattern:   "<yymmddhhmmss>.<id>.bundle",
		DistZipPattern:  "<yymmddhhmmss>.<id>.dist.zip",
		BundleFormat:    "git-bundle",
		DistZipFormat:   "deterministic-zip",
	}
}

func ReleaseArtifactNames(timestamp, id string) (string, string, error) {
	if _, err := parseReleaseTimestamp(timestamp); err != nil {
		return "", "", err
	}
	if !validID(id) {
		return "", "", fmt.Errorf("invalid release id: %q", id)
	}
	return timestamp + "." + id + ".bundle", timestamp + "." + id + ".dist.zip", nil
}

func CreateRelease(options ReleaseOptions) (ReleaseReceipt, error) {
	receipt := ReleaseReceipt{Schema: "capforge-release/1", Status: "FAIL"}
	root := options.Root
	if root == "" {
		root = "."
	}
	dist := options.Dist
	if dist == "" {
		dist = filepath.Join(root, "dist")
	}
	outDir := options.OutDir
	if outDir == "" {
		outDir = root
	}
	id := options.ID
	if id == "" {
		id = DefaultReleaseID
	}
	timestamp := options.Timestamp
	if timestamp == "" {
		timestamp = time.Now().In(releaseJST).Format(ReleaseTimestampLayout)
	}
	bundleName, distZipName, err := ReleaseArtifactNames(timestamp, id)
	if err != nil {
		return receipt, err
	}

	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return receipt, err
	}
	distAbs, err := filepath.Abs(dist)
	if err != nil {
		return receipt, err
	}
	outAbs, err := filepath.Abs(outDir)
	if err != nil {
		return receipt, err
	}
	if info, err := os.Stat(distAbs); err != nil || !info.IsDir() {
		if err == nil {
			err = fmt.Errorf("not a directory")
		}
		return receipt, fmt.Errorf("dist unavailable: %s: %w", distAbs, err)
	}
	if err := os.MkdirAll(outAbs, 0o755); err != nil {
		return receipt, err
	}
	gitSource, err := prepareReleaseGitSource(rootAbs, timestamp)
	if err != nil {
		return receipt, err
	}
	defer gitSource.cleanup()

	bundlePath := filepath.Join(outAbs, bundleName)
	distZipPath := filepath.Join(outAbs, distZipName)
	for _, path := range []string{bundlePath, distZipPath} {
		if _, err := os.Stat(path); err == nil {
			return receipt, fmt.Errorf("release artifact already exists: %s", path)
		} else if !os.IsNotExist(err) {
			return receipt, err
		}
	}

	bundleTemp := filepath.Join(outAbs, "."+bundleName+fmt.Sprintf(".tmp-%d", os.Getpid()))
	distTemp := filepath.Join(outAbs, "."+distZipName+fmt.Sprintf(".tmp-%d", os.Getpid()))
	defer os.Remove(bundleTemp)
	defer os.Remove(distTemp)

	if err := createGitBundle(gitSource.root, bundleTemp); err != nil {
		return receipt, err
	}
	if err := writeDeterministicZip(distAbs, distTemp); err != nil {
		return receipt, err
	}
	if err := os.Rename(bundleTemp, bundlePath); err != nil {
		return receipt, err
	}
	if err := os.Rename(distTemp, distZipPath); err != nil {
		_ = os.Remove(bundlePath)
		return receipt, err
	}

	bundleSHA, bundleBytes, err := fileSHA(bundlePath)
	if err != nil {
		return receipt, err
	}
	distSHA, distBytes, err := fileSHA(distZipPath)
	if err != nil {
		return receipt, err
	}
	receipt.Status = "PASS"
	receipt.TimestampJST = timestamp
	receipt.ID = id
	receipt.GitHead = gitSource.head
	receipt.GitMode = gitSource.mode
	receipt.Bundle = bundleName
	receipt.BundleBytes = bundleBytes
	receipt.BundleSHA256 = bundleSHA
	receipt.DistZip = distZipName
	receipt.DistZipBytes = distBytes
	receipt.DistZipSHA256 = distSHA
	return receipt, nil
}

func WriteDistProofManifest(dist string) error {
	proofDir := filepath.Join(dist, "proof")
	if err := os.MkdirAll(proofDir, 0o755); err != nil {
		return err
	}
	exclude := filepath.Clean(filepath.Join(proofDir, "manifest.json"))
	paths, err := sortedFiles(dist, func(path string, _ fs.DirEntry) bool {
		return filepath.Clean(path) != exclude
	})
	if err != nil {
		return err
	}
	files := make([]proofEntry, 0, len(paths))
	for _, path := range paths {
		sha, size, err := fileSHA(path)
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(dist, path)
		if err != nil {
			return err
		}
		files = append(files, proofEntry{Path: filepath.ToSlash(rel), Bytes: size, SHA256: sha})
	}
	manifest := proofManifest{Schema: "capforge-dist-proof-manifest/1", Status: "PASS", Files: files}
	return writeJSON(filepath.Join(proofDir, "manifest.json"), manifest)
}

func parseReleaseTimestamp(value string) (time.Time, error) {
	if len(value) != len(ReleaseTimestampLayout) {
		return time.Time{}, fmt.Errorf("timestamp must be yymmddhhmmss: %q", value)
	}
	for _, char := range value {
		if char < '0' || char > '9' {
			return time.Time{}, fmt.Errorf("timestamp must be yymmddhhmmss: %q", value)
		}
	}
	parsed, err := time.ParseInLocation(ReleaseTimestampLayout, value, releaseJST)
	if err != nil {
		return time.Time{}, fmt.Errorf("timestamp must be yymmddhhmmss: %q: %w", value, err)
	}
	return parsed, nil
}

type releaseGitSource struct {
	root    string
	head    string
	mode    string
	cleanup func()
}

func prepareReleaseGitSource(root, timestamp string) (releaseGitSource, error) {
	if _, err := os.Stat(filepath.Join(root, ".git")); err == nil {
		top, err := gitText(root, "rev-parse", "--show-toplevel")
		if err != nil {
			return releaseGitSource{}, fmt.Errorf("release source Git repository is invalid: %w", err)
		}
		topAbs, err := filepath.Abs(top)
		if err != nil {
			return releaseGitSource{}, err
		}
		rootAbs, err := filepath.Abs(root)
		if err != nil {
			return releaseGitSource{}, err
		}
		if filepath.Clean(topAbs) != filepath.Clean(rootAbs) {
			return releaseGitSource{}, fmt.Errorf("root must be the Git repository top-level: root=%s git=%s", rootAbs, topAbs)
		}
		head, err := gitText(root, "rev-parse", "--verify", "HEAD")
		if err != nil {
			return releaseGitSource{}, fmt.Errorf("Git repository has no committed HEAD: %w", err)
		}
		status, err := gitRaw(root, "status", "--porcelain", "--untracked-files=all")
		if err != nil {
			return releaseGitSource{}, err
		}
		if len(bytes.TrimSpace(status)) != 0 {
			return releaseGitSource{}, fmt.Errorf("Git worktree must be clean before publish:\n%s", strings.TrimSpace(string(status)))
		}
		return releaseGitSource{root: root, head: head, mode: "repository", cleanup: func() {}}, nil
	} else if !os.IsNotExist(err) {
		return releaseGitSource{}, err
	}

	temp, err := os.MkdirTemp("", "capforge-release-git-*")
	if err != nil {
		return releaseGitSource{}, err
	}
	cleanup := func() { _ = os.RemoveAll(temp) }
	paths, err := sourceArchiveFiles(root)
	if err != nil {
		cleanup()
		return releaseGitSource{}, err
	}
	for _, source := range paths {
		rel, err := filepath.Rel(root, source)
		if err != nil {
			cleanup()
			return releaseGitSource{}, err
		}
		info, err := os.Stat(source)
		if err != nil {
			cleanup()
			return releaseGitSource{}, err
		}
		data, err := os.ReadFile(source)
		if err != nil {
			cleanup()
			return releaseGitSource{}, err
		}
		if err := writeFile(filepath.Join(temp, rel), data, info.Mode()); err != nil {
			cleanup()
			return releaseGitSource{}, err
		}
	}
	if _, err := gitRaw(temp, "init", "-q", "-b", "main"); err != nil {
		cleanup()
		return releaseGitSource{}, err
	}
	if _, err := gitRaw(temp, "config", "user.name", "Capforge Publisher"); err != nil {
		cleanup()
		return releaseGitSource{}, err
	}
	if _, err := gitRaw(temp, "config", "user.email", "capforge@invalid.local"); err != nil {
		cleanup()
		return releaseGitSource{}, err
	}
	if _, err := gitRaw(temp, "add", "-A"); err != nil {
		cleanup()
		return releaseGitSource{}, err
	}
	parsed, err := parseReleaseTimestamp(timestamp)
	if err != nil {
		cleanup()
		return releaseGitSource{}, err
	}
	date := parsed.Format(time.RFC3339)
	cmd := exec.Command("git", "commit", "-q", "-m", "snapshot: capforge published source")
	cmd.Dir = temp
	cmd.Env = append(os.Environ(), "GIT_AUTHOR_DATE="+date, "GIT_COMMITTER_DATE="+date)
	if output, err := cmd.CombinedOutput(); err != nil {
		cleanup()
		return releaseGitSource{}, fmt.Errorf("git commit synthetic source: %w: %s", err, strings.TrimSpace(string(output)))
	}
	head, err := gitText(temp, "rev-parse", "HEAD")
	if err != nil {
		cleanup()
		return releaseGitSource{}, err
	}
	return releaseGitSource{root: temp, head: head, mode: "synthetic-snapshot", cleanup: cleanup}, nil
}

func createGitBundle(root, destination string) error {
	cmd := exec.Command("git", "-c", "pack.threads=1", "bundle", "create", destination, "--all")
	cmd.Dir = root
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("git bundle create: %w: %s", err, strings.TrimSpace(string(output)))
	}
	verify := exec.Command("git", "bundle", "verify", destination)
	verify.Dir = root
	output, err = verify.CombinedOutput()
	if err != nil {
		return fmt.Errorf("git bundle verify: %w: %s", err, strings.TrimSpace(string(output)))
	}
	return nil
}

func gitText(root string, args ...string) (string, error) {
	output, err := gitRaw(root, args...)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(output)), nil
}

func gitRaw(root string, args ...string) ([]byte, error) {
	cmd := exec.Command("git", args...)
	cmd.Dir = root
	output, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("git %s: %w: %s", strings.Join(args, " "), err, strings.TrimSpace(string(output)))
	}
	return output, nil
}

func writeDeterministicZip(root, output string) error {
	paths, err := sortedFiles(root, nil)
	if err != nil {
		return err
	}
	sort.Strings(paths)
	if err := os.MkdirAll(filepath.Dir(output), 0o755); err != nil {
		return err
	}
	file, err := os.Create(output)
	if err != nil {
		return err
	}
	writer := zip.NewWriter(file)
	fixed := time.Date(1980, 1, 1, 0, 0, 0, 0, time.UTC)
	for _, path := range paths {
		info, err := os.Stat(path)
		if err != nil {
			writer.Close()
			file.Close()
			return err
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			writer.Close()
			file.Close()
			return err
		}
		header, err := zip.FileInfoHeader(info)
		if err != nil {
			writer.Close()
			file.Close()
			return err
		}
		header.Name = filepath.ToSlash(rel)
		header.Method = zip.Deflate
		header.Modified = fixed
		header.SetMode(info.Mode())
		entryWriter, err := writer.CreateHeader(header)
		if err != nil {
			writer.Close()
			file.Close()
			return err
		}
		data, err := os.ReadFile(path)
		if err != nil {
			writer.Close()
			file.Close()
			return err
		}
		if _, err := entryWriter.Write(data); err != nil {
			writer.Close()
			file.Close()
			return err
		}
	}
	if err := writer.Close(); err != nil {
		file.Close()
		return err
	}
	return file.Close()
}
