package forge

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

func readProjectionSpec(path string) (*ProjectionSpec, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var spec ProjectionSpec
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&spec); err != nil {
		return nil, err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		if err == nil {
			return nil, errors.New("projection spec contains multiple JSON values")
		}
		return nil, fmt.Errorf("projection spec trailing data: %w", err)
	}
	if spec.Schema != ProjectionSchema {
		return nil, fmt.Errorf("unsupported projection schema: %q", spec.Schema)
	}
	if len(spec.Args) == 0 {
		return nil, errors.New("projection args are required")
	}
	if len(spec.Outputs) == 0 {
		return nil, errors.New("projection outputs are required")
	}
	if spec.TimeoutMS <= 0 {
		spec.TimeoutMS = 5000
	}
	if spec.TimeoutMS > 60000 {
		return nil, errors.New("projection timeout exceeds 60000ms")
	}
	return &spec, nil
}

func projectionInputs(root, capDir string, spec *ProjectionSpec) (map[string]string, map[string]struct{}, error) {
	inputs := map[string]string{}
	exclusions := map[string]struct{}{"fixture.json": {}, "projection.json": {}}
	if spec == nil {
		return inputs, exclusions, nil
	}
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return nil, nil, err
	}
	capAbs, err := filepath.Abs(capDir)
	if err != nil {
		return nil, nil, err
	}
	for _, rel := range spec.Inputs {
		clean := filepath.ToSlash(filepath.Clean(rel))
		if clean == "." || filepath.IsAbs(rel) || clean == ".." || strings.HasPrefix(clean, "../") {
			return nil, nil, fmt.Errorf("projection input escapes capability: %s", rel)
		}
		if _, duplicate := exclusions[clean]; duplicate {
			return nil, nil, fmt.Errorf("duplicate or reserved projection input: %s", clean)
		}
		path := filepath.Join(capAbs, filepath.FromSlash(clean))
		if !pathWithin(capAbs, path) {
			return nil, nil, fmt.Errorf("projection input escapes capability: %s", clean)
		}
		info, err := os.Stat(path)
		if err != nil || !info.Mode().IsRegular() {
			if err == nil {
				err = errors.New("not a regular file")
			}
			return nil, nil, fmt.Errorf("projection input unavailable: %s: %w", clean, err)
		}
		sha, _, err := fileSHA(path)
		if err != nil {
			return nil, nil, err
		}
		rootRel, err := filepath.Rel(rootAbs, path)
		if err != nil || strings.HasPrefix(rootRel, "..") {
			return nil, nil, fmt.Errorf("projection input is outside root: %s", clean)
		}
		inputs["./"+filepath.ToSlash(rootRel)] = sha
		exclusions[clean] = struct{}{}
	}
	return inputs, exclusions, nil
}

func normalizedProjectionOutputs(outputs []string) ([]string, map[string]struct{}, error) {
	cleaned := make([]string, 0, len(outputs))
	seen := map[string]struct{}{}
	for _, rel := range outputs {
		clean := filepath.ToSlash(filepath.Clean(rel))
		if clean == "." || filepath.IsAbs(rel) || clean == ".." || strings.HasPrefix(clean, "../") {
			return nil, nil, fmt.Errorf("projection output escapes dist: %s", rel)
		}
		if _, duplicate := seen[clean]; duplicate {
			return nil, nil, fmt.Errorf("duplicate projection output: %s", clean)
		}
		seen[clean] = struct{}{}
		cleaned = append(cleaned, clean)
	}
	sort.Strings(cleaned)
	return cleaned, seen, nil
}

func runProjection(root, dist, payload, capDir string) *ProjectionResult {
	spec, err := readProjectionSpec(filepath.Join(capDir, "projection.json"))
	if err != nil {
		return &ProjectionResult{Status: "FAIL", Error: "projection spec: " + err.Error()}
	}
	if spec == nil {
		return nil
	}
	inputs, _, err := projectionInputs(root, capDir, spec)
	if err != nil {
		return &ProjectionResult{Status: "FAIL", Error: "projection input: " + err.Error()}
	}
	outputPaths, expectedOutputs, err := normalizedProjectionOutputs(spec.Outputs)
	if err != nil {
		return &ProjectionResult{Status: "FAIL", Inputs: inputs, Error: err.Error()}
	}
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return &ProjectionResult{Status: "FAIL", Inputs: inputs, Error: err.Error()}
	}
	distAbs, err := filepath.Abs(dist)
	if err != nil {
		return &ProjectionResult{Status: "FAIL", Inputs: inputs, Error: err.Error()}
	}
	stageAbs, err := os.MkdirTemp("", "capforge-projection-*")
	if err != nil {
		return &ProjectionResult{Status: "FAIL", Inputs: inputs, Error: err.Error()}
	}
	defer os.RemoveAll(stageAbs)
	args := make([]string, len(spec.Args))
	for i, arg := range spec.Args {
		arg = strings.ReplaceAll(arg, "{root}", rootAbs)
		arg = strings.ReplaceAll(arg, "{dist}", stageAbs)
		if strings.Contains(arg, "{root}") || strings.Contains(arg, "{dist}") {
			return &ProjectionResult{Status: "FAIL", Inputs: inputs, Error: "unresolved projection placeholder"}
		}
		args[i] = arg
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(spec.TimeoutMS)*time.Millisecond)
	defer cancel()
	cmd := exec.CommandContext(ctx, payload, args...)
	cmd.Dir = rootAbs
	cmd.Env = []string{"PATH=", "LANG=C", "LC_ALL=C", "TZ=UTC", "HOME=/nonexistent"}
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		message := err.Error()
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			message = "timeout"
		}
		return &ProjectionResult{Status: "FAIL", Inputs: inputs, Stdout: stdout.String(), Stderr: stderr.String(), Error: message}
	}
	actualFiles, err := sortedFiles(stageAbs, nil)
	if err != nil {
		return &ProjectionResult{Status: "FAIL", Inputs: inputs, Stdout: stdout.String(), Stderr: stderr.String(), Error: err.Error()}
	}
	actualSet := map[string]struct{}{}
	for _, path := range actualFiles {
		rel, err := filepath.Rel(stageAbs, path)
		if err != nil {
			return &ProjectionResult{Status: "FAIL", Inputs: inputs, Stdout: stdout.String(), Stderr: stderr.String(), Error: err.Error()}
		}
		clean := filepath.ToSlash(rel)
		actualSet[clean] = struct{}{}
		if _, declared := expectedOutputs[clean]; !declared {
			return &ProjectionResult{Status: "FAIL", Inputs: inputs, Stdout: stdout.String(), Stderr: stderr.String(), Error: "undeclared projection output: " + clean}
		}
	}
	outputs := map[string]string{}
	for _, clean := range outputPaths {
		if _, exists := actualSet[clean]; !exists {
			return &ProjectionResult{Status: "FAIL", Inputs: inputs, Stdout: stdout.String(), Stderr: stderr.String(), Error: "projection output unavailable: " + clean}
		}
		source := filepath.Join(stageAbs, filepath.FromSlash(clean))
		path := filepath.Join(distAbs, filepath.FromSlash(clean))
		if !pathWithin(distAbs, path) {
			return &ProjectionResult{Status: "FAIL", Inputs: inputs, Stdout: stdout.String(), Stderr: stderr.String(), Error: "projection output escapes dist: " + clean}
		}
		if _, err := os.Stat(path); err == nil {
			return &ProjectionResult{Status: "FAIL", Inputs: inputs, Stdout: stdout.String(), Stderr: stderr.String(), Error: "projection output collides with existing dist file: " + clean}
		} else if !errors.Is(err, os.ErrNotExist) {
			return &ProjectionResult{Status: "FAIL", Inputs: inputs, Stdout: stdout.String(), Stderr: stderr.String(), Error: err.Error()}
		}
		info, err := os.Stat(source)
		if err != nil || !info.Mode().IsRegular() {
			if err == nil {
				err = errors.New("not a regular file")
			}
			return &ProjectionResult{Status: "FAIL", Inputs: inputs, Stdout: stdout.String(), Stderr: stderr.String(), Error: "projection output unavailable: " + clean + ": " + err.Error()}
		}
		if err := copyFile(source, path, info.Mode().Perm()); err != nil {
			return &ProjectionResult{Status: "FAIL", Inputs: inputs, Stdout: stdout.String(), Stderr: stderr.String(), Error: err.Error()}
		}
		sha, _, err := fileSHA(path)
		if err != nil {
			return &ProjectionResult{Status: "FAIL", Inputs: inputs, Stdout: stdout.String(), Stderr: stderr.String(), Error: err.Error()}
		}
		outputs["./"+clean] = sha
	}
	return &ProjectionResult{Status: "PASS", Inputs: inputs, Outputs: outputs, Stdout: stdout.String(), Stderr: stderr.String()}
}
