package admission

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
)

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

func runImportAdapter(b *Bundle, profile Profile, sourcePath string) (ImportReport, ToolIdentity, error) {
	adapterPath := filepath.Clean(filepath.Join(b.Dir, profile.Adapter))
	adapterBytes, err := os.ReadFile(adapterPath)
	if err != nil {
		return ImportReport{}, ToolIdentity{}, fmt.Errorf("ADAPTER_READ_FAILED: %s: %w", profile.ID, err)
	}
	version, err := normalizeToolVersion(profile.Tool)
	if err != nil {
		if errors.Is(err, exec.ErrNotFound) || strings.Contains(err.Error(), "executable file not found") {
			return ImportReport{}, ToolIdentity{}, fmt.Errorf("REQUIRED_TOOL_MISSING: %s", profile.Tool)
		}
		return ImportReport{}, ToolIdentity{}, fmt.Errorf("TOOL_VERSION_FAILED: %s: %w", profile.Tool, err)
	}
	var cmd *exec.Cmd
	switch profile.Tool {
	case "node":
		cmd = exec.Command("node", adapterPath, sourcePath)
	case "python3":
		cmd = exec.Command("python3", adapterPath, sourcePath)
	case "go":
		cmd = exec.Command("go", "run", adapterPath, "--", sourcePath)
	default:
		return ImportReport{}, ToolIdentity{}, fmt.Errorf("UNSUPPORTED_TOOL: %s", profile.Tool)
	}
	cmd.Env = []string{"PATH=" + os.Getenv("PATH"), "HOME=" + os.TempDir(), "GOCACHE=" + filepath.Join(os.TempDir(), "issue116-go-cache")}
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	if err := cmd.Run(); err != nil {
		return ImportReport{}, ToolIdentity{}, fmt.Errorf("PROVIDER_FAILED: %s: %v: %s", profile.ID, err, strings.TrimSpace(stderr.String()))
	}
	var report ImportReport
	if err := json.Unmarshal(stdout.Bytes(), &report); err != nil {
		return ImportReport{}, ToolIdentity{}, fmt.Errorf("PROVIDER_OUTPUT_INVALID: %s: %w", profile.ID, err)
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
	adapterSHA := "sha256:" + shaHex(adapterBytes)
	digest := "sha256:" + shaHex([]byte("shiftleft-tool/1\n"+profile.Tool+"\n"+version+"\n"+adapterSHA+"\n"))
	return report, ToolIdentity{Name: profile.Tool, Version: version, AdapterSHA256: adapterSHA, Digest: digest}, nil
}

func forbiddenSet(values []string) map[string]bool {
	out := map[string]bool{}
	for _, v := range values {
		out[v] = true
	}
	return out
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
	report, toolID, err := runImportAdapter(b, profile, sourcePath)
	if err != nil {
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
