package admission

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type diagnosticProcessReport struct {
	Schema         string     `json:"schema"`
	Status         string     `json:"status"`
	FindingCode    string     `json:"findingCode"`
	ContractSHA256 string     `json:"contractSha256"`
	Evidence       []Evidence `json:"evidence"`
}

func normalizeToolVersion(tool string) (string, error) {
	var args []string
	switch tool {
	case "node":
		args = []string{"--version"}
	case "python3":
		args = []string{"--version"}
	case "go":
		args = []string{"version"}
	default:
		args = []string{"--version"}
	}
	cmd := exec.Command(tool, args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

func findProfile(b *Bundle, id string) (Profile, bool) {
	for _, p := range b.Profiles {
		if p.ID == id {
			return p, true
		}
	}
	return Profile{}, false
}

func resolveProfileTool(b *Bundle, profile Profile) (string, error) {
	if profile.Tool == "ast-grep" {
		candidate := filepath.Clean(filepath.Join(b.Dir, "..", "bin", "ast-grep"))
		if info, err := os.Stat(candidate); err == nil && info.Mode().IsRegular() {
			return candidate, nil
		}
	}
	path, err := exec.LookPath(profile.Tool)
	if err != nil {
		return "", fmt.Errorf("REQUIRED_TOOL_MISSING: %s", profile.Tool)
	}
	return path, nil
}

func profileConfigSHA256(b *Bundle, profile Profile, seed []byte) (string, error) {
	parts := [][]byte{[]byte("shiftleft-provider-config/1\n"), seed}
	if profile.Rulepack != "" {
		rulePath := filepath.Clean(filepath.Join(b.Dir, profile.Rulepack))
		ruleBytes, err := os.ReadFile(rulePath)
		if err != nil {
			return "", fmt.Errorf("RULEPACK_READ_FAILED: %s: %w", profile.ID, err)
		}
		parts = append(parts, []byte("\nrulepack\n"), ruleBytes)
	}
	return "sha256:" + shaHex(bytes.Join(parts, nil)), nil
}

func runStructureAdapter(b *Bundle, profile Profile, sourcePath string) (ImportReport, ToolIdentity, error) {
	if profile.Provider != "astgrep-structure-provider" {
		return ImportReport{}, ToolIdentity{}, fmt.Errorf("UNSUPPORTED_TOOL: provider=%s", profile.Provider)
	}
	adapterPath := filepath.Clean(filepath.Join(b.Dir, profile.Adapter))
	rulePath := filepath.Clean(filepath.Join(b.Dir, profile.Rulepack))
	adapterBytes, err := os.ReadFile(adapterPath)
	if err != nil {
		return ImportReport{}, ToolIdentity{}, fmt.Errorf("ADAPTER_READ_FAILED: %s: %w", profile.ID, err)
	}
	ruleBytes, err := os.ReadFile(rulePath)
	if err != nil {
		return ImportReport{}, ToolIdentity{}, fmt.Errorf("RULEPACK_READ_FAILED: %s: %w", profile.ID, err)
	}
	toolPath, err := resolveProfileTool(b, profile)
	if err != nil {
		return ImportReport{}, ToolIdentity{}, err
	}
	version, err := normalizeToolVersion(toolPath)
	if err != nil {
		return ImportReport{}, ToolIdentity{}, fmt.Errorf("TOOL_VERSION_FAILED: %s: %w", profile.Tool, err)
	}
	adapterSHA := "sha256:" + shaHex(adapterBytes)
	ruleSHA := "sha256:" + shaHex(ruleBytes)
	digest := "sha256:" + shaHex([]byte(strings.Join([]string{
		"shiftleft-astgrep-tool/1", profile.Tool, version, adapterSHA, ruleSHA, "",
	}, "\n")))
	toolID := ToolIdentity{Name: profile.Tool, Version: version, AdapterSHA256: adapterSHA, Digest: digest}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "node", adapterPath,
		"--ast-grep", toolPath,
		"--rule", rulePath,
		"--source", sourcePath,
		"--language", profile.Language,
	)
	cmd.Env = []string{"PATH=" + os.Getenv("PATH"), "HOME=" + os.TempDir(), "LC_ALL=C", "NO_COLOR=1"}
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	runErr := cmd.Run()
	if ctx.Err() == context.DeadlineExceeded {
		return ImportReport{}, ToolIdentity{}, fmt.Errorf("PROVIDER_TIMEOUT: %s", profile.ID)
	}
	if runErr != nil {
		return ImportReport{}, ToolIdentity{}, fmt.Errorf("PROVIDER_FAILED: %s: %v: %s", profile.ID, runErr, strings.TrimSpace(stderr.String()))
	}
	var report ImportReport
	decoder := json.NewDecoder(bytes.NewReader(stdout.Bytes()))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&report); err != nil {
		return ImportReport{}, ToolIdentity{}, fmt.Errorf("PROVIDER_OUTPUT_INVALID: %s: %w", profile.ID, err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return ImportReport{}, ToolIdentity{}, fmt.Errorf("PROVIDER_OUTPUT_INVALID: %s: trailing JSON", profile.ID)
	}
	if report.Schema != "shiftleft-import-report/1" {
		return ImportReport{}, ToolIdentity{}, fmt.Errorf("PROVIDER_SCHEMA_INVALID: %s", report.Schema)
	}
	sort.Slice(report.Imports, func(i, j int) bool {
		if report.Imports[i].Module != report.Imports[j].Module {
			return report.Imports[i].Module < report.Imports[j].Module
		}
		return report.Imports[i].Line < report.Imports[j].Line
	})
	return report, toolID, nil
}

func providerCommand(profile Profile, adapterPath string, args ...string) (*exec.Cmd, error) {
	switch profile.Tool {
	case "node":
		return exec.Command("node", append([]string{adapterPath}, args...)...), nil
	case "python3":
		return exec.Command("python3", append([]string{adapterPath}, args...)...), nil
	case "go":
		return exec.Command("go", append([]string{"run", adapterPath, "--"}, args...)...), nil
	default:
		return nil, fmt.Errorf("UNSUPPORTED_TOOL: %s", profile.Tool)
	}
}

func runDiagnosticProcessAdapter(b *Bundle, profile Profile, sourcePath string) (diagnosticProcessReport, ToolIdentity, error) {
	adapterPath := filepath.Clean(filepath.Join(b.Dir, profile.Adapter))
	adapterBytes, err := os.ReadFile(adapterPath)
	if err != nil {
		return diagnosticProcessReport{}, ToolIdentity{}, fmt.Errorf("ADAPTER_READ_FAILED: %s: %w", profile.ID, err)
	}
	version, err := normalizeToolVersion(profile.Tool)
	if err != nil {
		if errors.Is(err, exec.ErrNotFound) || strings.Contains(err.Error(), "executable file not found") {
			return diagnosticProcessReport{}, ToolIdentity{}, fmt.Errorf("REQUIRED_TOOL_MISSING: %s", profile.Tool)
		}
		return diagnosticProcessReport{}, ToolIdentity{}, fmt.Errorf("TOOL_VERSION_FAILED: %s: %w", profile.Tool, err)
	}
	cmd, err := providerCommand(profile, adapterPath, sourcePath)
	if err != nil {
		return diagnosticProcessReport{}, ToolIdentity{}, err
	}
	cmd.Env = []string{"PATH=" + os.Getenv("PATH"), "HOME=" + os.TempDir()}
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	if err := cmd.Run(); err != nil {
		return diagnosticProcessReport{}, ToolIdentity{}, fmt.Errorf("PROVIDER_FAILED: %s: %v: %s", profile.ID, err, strings.TrimSpace(stderr.String()))
	}
	var report diagnosticProcessReport
	if err := json.Unmarshal(stdout.Bytes(), &report); err != nil {
		return diagnosticProcessReport{}, ToolIdentity{}, fmt.Errorf("PROVIDER_OUTPUT_INVALID: %s: %w", profile.ID, err)
	}
	if report.Schema != "shiftleft-diagnostic-process-report/1" {
		return diagnosticProcessReport{}, ToolIdentity{}, fmt.Errorf("PROVIDER_SCHEMA_INVALID: %s", report.Schema)
	}
	if !validStatus(report.Status) || !nonblank(report.FindingCode) || !validSHA256Digest(report.ContractSHA256) || len(report.Evidence) == 0 {
		return diagnosticProcessReport{}, ToolIdentity{}, fmt.Errorf("PROVIDER_REPORT_INVALID: %s", profile.ID)
	}
	adapterSHA := "sha256:" + shaHex(adapterBytes)
	digest := "sha256:" + shaHex([]byte(strings.Join([]string{
		"shiftleft-diagnostic-process-tool/1", profile.Tool, version, adapterSHA, report.ContractSHA256, "",
	}, "\n")))
	toolID := ToolIdentity{Name: profile.Tool, Version: version, AdapterSHA256: adapterSHA, Digest: digest}
	return report, toolID, nil
}

func validSHA256Digest(value string) bool {
	if !strings.HasPrefix(value, "sha256:") || len(value) != len("sha256:")+64 {
		return false
	}
	_, err := hex.DecodeString(strings.TrimPrefix(value, "sha256:"))
	return err == nil
}

func forbiddenSet(values []string) map[string]bool {
	out := map[string]bool{}
	for _, v := range values {
		out[v] = true
	}
	return out
}

func providerFailure(base Observation, err error) (Observation, error) {
	base.Status = StatusUnobserved
	switch {
	case strings.Contains(err.Error(), "REQUIRED_TOOL_MISSING"):
		base.FindingCode = "required-tool-missing"
	case strings.Contains(err.Error(), "UNSUPPORTED_TOOL"):
		base.FindingCode = "unsupported-required-adapter"
	default:
		base.FindingCode = "provider-failed"
	}
	base.Evidence = []Evidence{{Kind: "provider", Detail: err.Error()}}
	return finalizeObservation(base)
}

func observeFixture(b *Bundle, fixturePath string, fixture Fixture) (Observation, error) {
	profile, ok := findProfile(b, fixture.ProfileID)
	configBytes, _ := json.Marshal(fixture)
	base := Observation{
		Schema: "shiftleft-observation/1", RuleID: fixture.RuleID, ProfileID: fixture.ProfileID,
		PackageID: fixture.PackageID, Language: fixture.Language, Required: profile.Required,
		FixtureKind: fixture.FixtureKind, CaseID: fixture.CaseID,
		ConfigSHA256: "sha256:" + shaHex(configBytes), Evidence: []Evidence{},
	}
	if !ok {
		base.Required = true
		base.Status = StatusUnobserved
		base.FindingCode = "unsupported-required-profile"
		base.Evidence = []Evidence{{Kind: "provider", Detail: "profile not found"}}
		return finalizeObservation(base)
	}
	if profile.Language != fixture.Language || profile.RuleID != fixture.RuleID {
		base.Status = StatusUnobserved
		base.FindingCode = "unsupported-language"
		base.Evidence = []Evidence{{Kind: "provider", Detail: "profile language/rule mismatch"}}
		return finalizeObservation(base)
	}
	sourcePath := filepath.Join(filepath.Dir(fixturePath), fixture.Source)
	sourceBytes, err := os.ReadFile(sourcePath)
	if err != nil {
		base.Status = StatusUnobserved
		base.FindingCode = "source-missing"
		base.Evidence = []Evidence{{Kind: "source", Path: fixture.Source, Detail: err.Error()}}
		return finalizeObservation(base)
	}
	rel, _ := filepath.Rel(filepath.Dir(filepath.Dir(filepath.Dir(fixturePath))), sourcePath)
	base.SourcePath = filepath.ToSlash(rel)
	base.SourceSHA256 = "sha256:" + shaHex(sourceBytes)
	base.ConfigSHA256, err = profileConfigSHA256(b, profile, configBytes)
	if err != nil {
		return providerFailure(base, err)
	}

	switch profile.Provider {
	case "astgrep-structure-provider":
		report, toolID, err := runStructureAdapter(b, profile, sourcePath)
		if err != nil {
			return providerFailure(base, err)
		}
		base.Tool = toolID
		forbidden := forbiddenSet(profile.ForbiddenImports)
		hits := []ImportFinding{}
		for _, imp := range report.Imports {
			if forbidden[imp.Module] {
				hits = append(hits, imp)
			}
		}
		if len(hits) > 0 {
			base.Status = StatusUnmet
			base.FindingCode = "core-imports-effect-adapter"
			for _, hit := range hits {
				base.Evidence = append(base.Evidence, Evidence{Kind: "forbidden-import", Path: base.SourcePath, Line: hit.Line, Detail: hit.Module})
			}
		} else {
			base.Status = StatusMet
			base.FindingCode = "core-import-boundary-clean"
			base.Evidence = []Evidence{{Kind: "import-scan", Path: base.SourcePath, Detail: fmt.Sprintf("%d imports; no forbidden effect adapter", len(report.Imports))}}
		}
		return finalizeObservation(base)

	case "diagnostic-process-provider":
		report, toolID, err := runDiagnosticProcessAdapter(b, profile, sourcePath)
		if err != nil {
			return providerFailure(base, err)
		}
		base.Tool = toolID
		base.Status = report.Status
		base.FindingCode = report.FindingCode
		base.Evidence = append(report.Evidence, Evidence{Kind: "contract", Path: "structured-diagnostic/contract.json", Detail: report.ContractSHA256})
		return finalizeObservation(base)

	default:
		base.Status = StatusUnobserved
		base.FindingCode = "unsupported-required-adapter"
		base.Evidence = []Evidence{{Kind: "provider", Detail: "unsupported provider: " + profile.Provider}}
		return finalizeObservation(base)
	}
}

func ObserveFixtures(b *Bundle, fixturesDir string) ([]Observation, error) {
	paths := []string{}
	err := filepath.WalkDir(fixturesDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !d.IsDir() && d.Name() == "fixture.json" {
			paths = append(paths, path)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Strings(paths)
	observations := []Observation{}
	for _, path := range paths {
		data, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		var fixture Fixture
		if err := json.Unmarshal(data, &fixture); err != nil {
			return nil, fmt.Errorf("FIXTURE_PARSE_FAILED: %s: %w", path, err)
		}
		observation, err := observeFixture(b, path, fixture)
		if err != nil {
			return nil, err
		}
		observations = append(observations, observation)
	}
	return observations, nil
}
