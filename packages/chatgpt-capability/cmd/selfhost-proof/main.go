package main

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"

	"capforge.local/platform/internal/forge"
)

type bootstrap struct {
	Capforge struct {
		SHA256      string `json:"payloadSha256"`
		CarrierPath string `json:"carrierPath"`
	} `json:"capforge"`
	Search struct {
		SHA256 string `json:"payloadSha256"`
	} `json:"search"`
	SourceKit struct {
		SHA256      string `json:"sha256"`
		CarrierPath string `json:"carrierPath"`
	} `json:"sourceKit"`
}

type commandOutput struct {
	Project struct {
		Status      string `json:"status"`
		BuiltCount  int    `json:"builtCount"`
		ReusedCount int    `json:"reusedCount"`
		ActiveCount int    `json:"activeCount"`
	} `json:"project"`
	Verify struct {
		Status string `json:"status"`
	} `json:"verify"`
	Release struct {
		Status  string `json:"status"`
		ID      string `json:"id"`
		GitMode string `json:"gitMode"`
		Bundle  string `json:"bundle"`
		DistZip string `json:"distZip"`
	} `json:"release"`
}

type registryRecord struct {
	ID             string `json:"id"`
	Status         string `json:"status"`
	Implementation *struct {
		PayloadSHA256 string   `json:"payloadSha256"`
		CarrierPath   string   `json:"carrierPath"`
		Fixture       *fixture `json:"fixture"`
	} `json:"implementation"`
}

type fixture struct {
	Args     []string `json:"args"`
	Stdin    string   `json:"stdin"`
	Stdout   string   `json:"stdout"`
	Stderr   string   `json:"stderr"`
	ExitCode int      `json:"exitCode"`
}

type receipt struct {
	Schema                string `json:"schema"`
	Status                string `json:"status"`
	CapforgeMaterialized  bool   `json:"capforgeMaterialized"`
	SourceKitMaterialized bool   `json:"sourceKitMaterialized"`
	InitialBuilt          int    `json:"initialBuilt"`
	InitialReused         int    `json:"initialReused"`
	ExtensionBuilt        int    `json:"extensionBuilt"`
	ExtensionReused       int    `json:"extensionReused"`
	RepeatBuilt           int    `json:"repeatBuilt"`
	RepeatReused          int    `json:"repeatReused"`
	PlatformHashStable    bool   `json:"platformHashStable"`
	ExtensionRegistry     string `json:"extensionRegistry"`
	ExtensionExecution    string `json:"extensionExecution"`
	CentralSourceEdits    int    `json:"centralSourceEdits"`
	ReleaseNamingPass     bool   `json:"releaseNamingPass"`
	ReleaseBundle         string `json:"releaseBundle"`
	ReleaseDistZip        string `json:"releaseDistZip"`
	ReleaseGitMode        string `json:"releaseGitMode"`
	Error                 string `json:"error,omitempty"`
}

func main() {
	dist := flag.String("dist", "dist", "deployed dist snapshot")
	out := flag.String("out", "build/selfhost-proof.json", "receipt path")
	flag.Parse()
	r := receipt{Schema: "capforge-selfhost-proof/1", Status: "FAIL", CentralSourceEdits: 0}
	if err := run(*dist, &r); err != nil {
		r.Error = err.Error()
		finish(r, *out)
		os.Exit(1)
	}
	r.Status = "PASS"
	finish(r, *out)
}

func run(dist string, r *receipt) error {
	bootstrapData, err := os.ReadFile(filepath.Join(dist, ".well-known", "bootstrap.json"))
	if err != nil {
		return err
	}
	var boot bootstrap
	if err := json.Unmarshal(bootstrapData, &boot); err != nil {
		return err
	}
	work, err := os.MkdirTemp("", "capforge-selfhost-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(work)

	capCarrier := filepath.Join(dist, filepath.FromSlash(strings.TrimPrefix(boot.Capforge.CarrierPath, "./")))
	capBytes, err := decodeCarrier(capCarrier, boot.Capforge.SHA256)
	if err != nil {
		return err
	}
	capforge := filepath.Join(work, "capforge")
	if err := os.WriteFile(capforge, capBytes, 0o755); err != nil {
		return err
	}
	if output, err := exec.Command(capforge, "version").CombinedOutput(); err != nil || string(output) != "capforge/1\n" {
		return fmt.Errorf("materialized capforge failed: %v %q", err, output)
	}
	r.CapforgeMaterialized = true

	kitCarrier := filepath.Join(dist, filepath.FromSlash(strings.TrimPrefix(boot.SourceKit.CarrierPath, "./")))
	kitBytes, err := decodeCarrier(kitCarrier, boot.SourceKit.SHA256)
	if err != nil {
		return err
	}
	workspace := filepath.Join(work, "workspace")
	if err := extractZip(kitBytes, workspace); err != nil {
		return err
	}
	r.SourceKitMaterialized = true

	initial, err := project(capforge, workspace)
	if err != nil {
		return fmt.Errorf("initial project: %w", err)
	}
	r.InitialBuilt, r.InitialReused = initial.Project.BuiltCount, initial.Project.ReusedCount
	if initial.Project.BuiltCount != 0 || initial.Project.ReusedCount < 2 {
		return fmt.Errorf("source kit did not reuse existing cache: built=%d reused=%d", initial.Project.BuiltCount, initial.Project.ReusedCount)
	}
	before, err := readBootstrap(filepath.Join(workspace, "dist"))
	if err != nil {
		return err
	}
	centralBefore, err := centralHashes(workspace)
	if err != nil {
		return err
	}

	add := exec.Command(capforge, "add", "--root", workspace, "--id", "go-extension-proof", "--title", "Go Extension Proof", "--purpose", "deployed distから追加したPro拡張", "--message", "Pro extension added")
	if output, err := add.CombinedOutput(); err != nil {
		return fmt.Errorf("add: %v: %s", err, output)
	}
	centralAfter, err := centralHashes(workspace)
	if err != nil {
		return err
	}
	for path, beforeHash := range centralBefore {
		if centralAfter[path] != beforeHash {
			r.CentralSourceEdits++
		}
	}
	for path := range centralAfter {
		if _, existed := centralBefore[path]; !existed {
			r.CentralSourceEdits++
		}
	}
	if r.CentralSourceEdits != 0 {
		return fmt.Errorf("add modified central source: %d files", r.CentralSourceEdits)
	}
	extended, err := project(capforge, workspace)
	if err != nil {
		return fmt.Errorf("extended project: %w", err)
	}
	r.ExtensionBuilt, r.ExtensionReused = extended.Project.BuiltCount, extended.Project.ReusedCount
	if extended.Project.BuiltCount != 1 || extended.Project.ReusedCount < 2 {
		return fmt.Errorf("extension build counts unexpected: built=%d reused=%d", extended.Project.BuiltCount, extended.Project.ReusedCount)
	}
	after, err := readBootstrap(filepath.Join(workspace, "dist"))
	if err != nil {
		return err
	}
	r.PlatformHashStable = before.Capforge.SHA256 == after.Capforge.SHA256 && before.Search.SHA256 == after.Search.SHA256
	if !r.PlatformHashStable {
		return fmt.Errorf("platform payload hashes changed while adding capability")
	}

	record, err := findRegistry(filepath.Join(workspace, "dist", ".well-known", "registry.jsonl"), "go-extension-proof")
	if err != nil {
		return err
	}
	r.ExtensionRegistry = record.Status
	if record.Status != "active" || record.Implementation == nil || record.Implementation.Fixture == nil {
		return fmt.Errorf("extension not active")
	}
	payload, err := decodeCarrier(filepath.Join(workspace, "dist", filepath.FromSlash(strings.TrimPrefix(record.Implementation.CarrierPath, "./"))), record.Implementation.PayloadSHA256)
	if err != nil {
		return err
	}
	binaryPath := filepath.Join(work, "extension")
	if err := os.WriteFile(binaryPath, payload, 0o755); err != nil {
		return err
	}
	cmd := exec.Command(binaryPath, record.Implementation.Fixture.Args...)
	cmd.Stdin = strings.NewReader(record.Implementation.Fixture.Stdin)
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	err = cmd.Run()
	exit := 0
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exit = exitErr.ExitCode()
		} else {
			return err
		}
	}
	if stdout.String() != record.Implementation.Fixture.Stdout || stderr.String() != record.Implementation.Fixture.Stderr || exit != record.Implementation.Fixture.ExitCode {
		return fmt.Errorf("restored extension fixture mismatch")
	}
	r.ExtensionExecution = strings.TrimSpace(stdout.String())

	repeat, err := project(capforge, workspace)
	if err != nil {
		return fmt.Errorf("repeat project: %w", err)
	}
	r.RepeatBuilt, r.RepeatReused = repeat.Project.BuiltCount, repeat.Project.ReusedCount
	if repeat.Project.BuiltCount != 0 || repeat.Project.ReusedCount < 3 {
		return fmt.Errorf("repeat projection rebuilt unchanged capability: built=%d reused=%d", repeat.Project.BuiltCount, repeat.Project.ReusedCount)
	}

	const proofTimestamp = "260816000000"
	proofID := forge.DefaultReleaseID
	releaseOut := filepath.Join(work, "release")
	published, err := publish(capforge, workspace, releaseOut, proofTimestamp)
	if err != nil {
		return fmt.Errorf("publish: %w", err)
	}
	wantBundle := proofTimestamp + "." + proofID + ".bundle"
	wantDistZip := proofTimestamp + "." + proofID + ".dist.zip"
	r.ReleaseBundle = published.Release.Bundle
	r.ReleaseDistZip = published.Release.DistZip
	r.ReleaseGitMode = published.Release.GitMode
	r.ReleaseNamingPass = published.Release.Status == "PASS" &&
		published.Release.ID == proofID &&
		published.Release.Bundle == wantBundle &&
		published.Release.DistZip == wantDistZip
	if !r.ReleaseNamingPass {
		return fmt.Errorf("release naming mismatch: %+v", published.Release)
	}
	for _, name := range []string{wantBundle, wantDistZip} {
		if info, err := os.Stat(filepath.Join(releaseOut, name)); err != nil || !info.Mode().IsRegular() {
			return fmt.Errorf("release artifact unavailable: %s: %v", name, err)
		}
	}
	verifyBundle := exec.Command("git", "bundle", "verify", filepath.Join(releaseOut, wantBundle))
	if output, err := verifyBundle.CombinedOutput(); err != nil {
		return fmt.Errorf("release bundle verify: %v: %s", err, output)
	}
	return nil
}

func project(capforge, workspace string) (commandOutput, error) {
	cmd := exec.Command(capforge, "project", "--root", workspace, "--dist", filepath.Join(workspace, "dist"))
	return decodeCommandOutput(cmd, false)
}

func publish(capforge, workspace, out, timestamp string) (commandOutput, error) {
	cmd := exec.Command(capforge, "publish", "--root", workspace, "--dist", filepath.Join(workspace, "dist"), "--out", out, "--timestamp", timestamp)
	return decodeCommandOutput(cmd, true)
}

func decodeCommandOutput(cmd *exec.Cmd, requireRelease bool) (commandOutput, error) {
	output, err := cmd.CombinedOutput()
	if err != nil {
		return commandOutput{}, fmt.Errorf("%v: %s", err, output)
	}
	var result commandOutput
	if err := json.Unmarshal(output, &result); err != nil {
		return result, fmt.Errorf("decode command output: %w: %s", err, output)
	}
	if result.Project.Status != "PASS" || result.Verify.Status != "PASS" {
		return result, fmt.Errorf("project or verify failed")
	}
	if requireRelease && result.Release.Status != "PASS" {
		return result, fmt.Errorf("release failed")
	}
	return result, nil
}

func readBootstrap(dist string) (bootstrap, error) {
	data, err := os.ReadFile(filepath.Join(dist, ".well-known", "bootstrap.json"))
	if err != nil {
		return bootstrap{}, err
	}
	var value bootstrap
	err = json.Unmarshal(data, &value)
	return value, err
}

func findRegistry(path, id string) (registryRecord, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return registryRecord{}, err
	}
	for _, line := range strings.Split(strings.TrimSpace(string(data)), "\n") {
		var record registryRecord
		if json.Unmarshal([]byte(line), &record) == nil && record.ID == id {
			return record, nil
		}
	}
	return registryRecord{}, fmt.Errorf("registry record not found: %s", id)
}

func decodeCarrier(path, expectedSHA string) ([]byte, error) {
	text, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	payload, err := base64.StdEncoding.Strict().DecodeString(string(text))
	if err != nil {
		return nil, err
	}
	if sha(payload) != expectedSHA {
		return nil, fmt.Errorf("SHA mismatch for %s", path)
	}
	return payload, nil
}

func sha(data []byte) string {
	sum := sha256.Sum256(data)
	return fmt.Sprintf("%x", sum[:])
}

func extractZip(data []byte, target string) error {
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return err
	}
	for _, file := range reader.File {
		clean := filepath.Clean(file.Name)
		if clean == "." || filepath.IsAbs(clean) || strings.HasPrefix(clean, ".."+string(filepath.Separator)) || clean == ".." {
			return fmt.Errorf("unsafe zip path: %s", file.Name)
		}
		path := filepath.Join(target, filepath.FromSlash(clean))
		if !strings.HasPrefix(filepath.Clean(path), filepath.Clean(target)+string(filepath.Separator)) {
			return fmt.Errorf("zip path escapes target: %s", file.Name)
		}
		if file.FileInfo().IsDir() {
			if err := os.MkdirAll(path, 0o755); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return err
		}
		source, err := file.Open()
		if err != nil {
			return err
		}
		destination, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, file.Mode())
		if err != nil {
			source.Close()
			return err
		}
		_, copyErr := io.Copy(destination, source)
		closeErr := destination.Close()
		source.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeErr != nil {
			return closeErr
		}
	}
	return nil
}

func centralHashes(root string) (map[string]string, error) {
	var paths []string
	for _, rel := range []string{"cmd", "internal", "go.mod", "go.sum", "README.md"} {
		path := filepath.Join(root, rel)
		info, err := os.Stat(path)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return nil, err
		}
		if !info.IsDir() {
			paths = append(paths, path)
			continue
		}
		err = filepath.Walk(path, func(current string, info os.FileInfo, err error) error {
			if err != nil {
				return err
			}
			if !info.IsDir() {
				paths = append(paths, current)
			}
			return nil
		})
		if err != nil {
			return nil, err
		}
	}
	sort.Strings(paths)
	result := map[string]string{}
	for _, path := range paths {
		data, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		rel, _ := filepath.Rel(root, path)
		result[filepath.ToSlash(rel)] = sha(data)
	}
	return result, nil
}

func finish(r receipt, path string) {
	data, _ := json.MarshalIndent(r, "", "  ")
	data = append(data, '\n')
	_ = os.MkdirAll(filepath.Dir(path), 0o755)
	_ = os.WriteFile(path, data, 0o644)
	fmt.Print(string(data))
}
