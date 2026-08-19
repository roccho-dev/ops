package admission

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	pathpkg "path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

const (
	localIntakeSchema     = "shiftleft-local-intake-receipt/2"
	localTaskSchema       = "shiftleft-local-task-contract/1"
	localCompletionSchema = "shiftleft-local-completion-receipt/1"
)

var localIDRE = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{1,127}$`)
var artifactIDRE = regexp.MustCompile(`^[1-9][0-9]*$`)
var releaseIDRE = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{1,255}$`)
var sha256RE = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)

type LocalIntakeReceipt struct {
	Schema           string `json:"schema"`
	Status           string `json:"status"`
	SourceKind       string `json:"sourceKind"`
	SourceID         string `json:"sourceId"`
	SourceSHA256     string `json:"sourceSha256"`
	PolicyRef        string `json:"policyRef"`
	PolicyHash       string `json:"policyHash"`
	RuntimeSHA256    string `json:"runtimeSha256"`
	AstGrepSHA256    string `json:"astGrepSha256"`
	AdaptersSHA256   string `json:"adaptersSha256"`
	ProvidersSHA256  string `json:"providersSha256"`
	RulepacksSHA256  string `json:"rulepacksSha256"`
	ToolchainsSHA256 string `json:"toolchainsSha256"`
	PolicyPath       string `json:"policyPath"`
	AdaptersPath     string `json:"adaptersPath"`
	ProvidersPath    string `json:"providersPath"`
	RulepacksPath    string `json:"rulepacksPath"`
	ToolchainsPath   string `json:"toolchainsPath"`
	RuntimePath      string `json:"runtimePath"`
	AstGrepPath      string `json:"astGrepPath"`
	ReceiptDigest    string `json:"receiptDigest"`
}

type LocalTest struct {
	ID             string   `json:"id"`
	Command        []string `json:"command"`
	TimeoutSeconds int      `json:"timeoutSeconds,omitempty"`
}

type LocalTaskContract struct {
	Schema    string          `json:"schema"`
	TaskID    string          `json:"taskId"`
	Language  string          `json:"language"`
	ProfileID string          `json:"profileId"`
	Scope     []string        `json:"scope"`
	Package   PackageContract `json:"package"`
	Tests     []LocalTest     `json:"tests"`
}

type LocalTestResult struct {
	ID       string       `json:"id"`
	Command  []string     `json:"command"`
	Status   string       `json:"status"`
	ExitCode int          `json:"exitCode"`
	Tool     ToolIdentity `json:"tool"`
}

type LocalCompletionReceipt struct {
	Schema                string            `json:"schema"`
	Status                string            `json:"status"`
	TerminalState         string            `json:"terminalState"`
	IntakeReceiptDigest   string            `json:"intakeReceiptDigest"`
	SourceKind            string            `json:"sourceKind"`
	SourceID              string            `json:"sourceId"`
	SourceSHA256          string            `json:"sourceSha256"`
	PolicyRef             string            `json:"policyRef"`
	PolicyHash            string            `json:"policyHash"`
	TaskID                string            `json:"taskId"`
	TaskContractDigest    string            `json:"taskContractDigest"`
	WorkspaceKind         string            `json:"workspaceKind"`
	BaseTree              string            `json:"baseTree"`
	CandidateTree         string            `json:"candidateTree"`
	ObservedCandidateTree string            `json:"observedCandidateTree"`
	ScopeDigest           string            `json:"scopeDigest"`
	ToolchainDigest       string            `json:"toolchainDigest"`
	ObservationRootDigest string            `json:"observationRootDigest"`
	Tests                 []LocalTestResult `json:"tests"`
	Admission             *Receipt          `json:"admission,omitempty"`
	SemanticDigest        string            `json:"semanticDigest"`
	ReceiptDigest         string            `json:"receiptDigest"`
}

type manifestEntry struct {
	SHA  string
	Path string
}

func finalizeLocalIntakeReceipt(r LocalIntakeReceipt) (LocalIntakeReceipt, error) {
	r.ReceiptDigest = ""
	d, err := digestWithPrefix(localIntakeSchema, r)
	if err != nil {
		return LocalIntakeReceipt{}, err
	}
	r.ReceiptDigest = d
	return r, nil
}

func validateLocalIntakeReceipt(r LocalIntakeReceipt) error {
	got := r.ReceiptDigest
	r.ReceiptDigest = ""
	d, err := digestWithPrefix(localIntakeSchema, r)
	if err != nil {
		return err
	}
	if got != d {
		return fmt.Errorf("INTAKE_RECEIPT_DIGEST_MISMATCH: expected %s got %s", got, d)
	}
	if r.Schema != localIntakeSchema || r.Status != "PASS" {
		return fmt.Errorf("INTAKE_RECEIPT_NOT_PASS: schema=%s status=%s", r.Schema, r.Status)
	}
	return nil
}

func finalizeLocalCompletionReceipt(r LocalCompletionReceipt) (LocalCompletionReceipt, error) {
	sort.Slice(r.Tests, func(i, j int) bool { return r.Tests[i].ID < r.Tests[j].ID })
	r.SemanticDigest = ""
	r.ReceiptDigest = ""
	semantic, err := digestWithPrefix("shiftleft-local-completion-semantic/1", r)
	if err != nil {
		return LocalCompletionReceipt{}, err
	}
	r.SemanticDigest = semantic
	r.ReceiptDigest = ""
	digest, err := digestWithPrefix(localCompletionSchema, r)
	if err != nil {
		return LocalCompletionReceipt{}, err
	}
	r.ReceiptDigest = digest
	return r, nil
}

func cleanRelative(value string) (string, error) {
	value = filepath.ToSlash(strings.TrimSpace(value))
	if value == "" || strings.ContainsRune(value, '\x00') || strings.HasPrefix(value, "/") {
		return "", fmt.Errorf("UNSAFE_RELATIVE_PATH: %q", value)
	}
	clean := pathpkg.Clean(value)
	if clean == "." || clean != value || clean == ".." || strings.HasPrefix(clean, "../") {
		return "", fmt.Errorf("UNSAFE_RELATIVE_PATH: %q", value)
	}
	return clean, nil
}

func pathUnder(root, rel string) (string, error) {
	clean, err := cleanRelative(rel)
	if err != nil {
		return "", err
	}
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	candidate := filepath.Join(rootAbs, filepath.FromSlash(clean))
	candidateAbs, err := filepath.Abs(candidate)
	if err != nil {
		return "", err
	}
	if candidateAbs == rootAbs || !strings.HasPrefix(candidateAbs, rootAbs+string(os.PathSeparator)) {
		return "", fmt.Errorf("UNSAFE_RELATIVE_PATH: %q", rel)
	}
	return candidateAbs, nil
}

func fileSHA(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return "sha256:" + shaHex(data), nil
}

func regularFileHashes(root string) (map[string]string, error) {
	out := map[string]string{}
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("SOURCE_SPECIAL_FILE_FORBIDDEN: %s", path)
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		if rel == "SHA256SUMS" {
			return nil
		}
		sha, err := fileSHA(path)
		if err != nil {
			return err
		}
		out[rel] = strings.TrimPrefix(sha, "sha256:")
		return nil
	})
	return out, err
}

func canonicalManifest(files map[string]string) []byte {
	paths := make([]string, 0, len(files))
	for p := range files {
		paths = append(paths, p)
	}
	sort.Strings(paths)
	var out strings.Builder
	for _, p := range paths {
		fmt.Fprintf(&out, "%s  %s\n", files[p], p)
	}
	return []byte(out.String())
}

func parseManifest(data []byte) ([]manifestEntry, error) {
	if len(data) == 0 || data[len(data)-1] != '\n' {
		return nil, fmt.Errorf("SOURCE_MANIFEST_INVALID: final newline required")
	}
	lines := strings.Split(strings.TrimSuffix(string(data), "\n"), "\n")
	entries := make([]manifestEntry, 0, len(lines))
	seen := map[string]bool{}
	previous := ""
	shaRE := regexp.MustCompile(`^[0-9a-f]{64}$`)
	for _, line := range lines {
		if len(line) < 67 || line[64:66] != "  " || !shaRE.MatchString(line[:64]) {
			return nil, fmt.Errorf("SOURCE_MANIFEST_INVALID: %q", line)
		}
		rel, err := cleanRelative(line[66:])
		if err != nil {
			return nil, err
		}
		if seen[rel] || (previous != "" && rel <= previous) {
			return nil, fmt.Errorf("SOURCE_MANIFEST_ORDER_INVALID: %s", rel)
		}
		seen[rel] = true
		previous = rel
		entries = append(entries, manifestEntry{SHA: line[:64], Path: rel})
	}
	return entries, nil
}

func verifySourceManifest(root, expected string) (string, error) {
	if !sha256RE.MatchString(expected) {
		return "", fmt.Errorf("SOURCE_SHA256_INVALID: %q", expected)
	}
	manifestPath := filepath.Join(root, "SHA256SUMS")
	data, err := os.ReadFile(manifestPath)
	if err != nil {
		return "", fmt.Errorf("SOURCE_MANIFEST_READ_FAILED: %w", err)
	}
	actualManifestSHA := "sha256:" + shaHex(data)
	if actualManifestSHA != expected {
		return "", fmt.Errorf("SOURCE_SHA256_MISMATCH: expected %s got %s", expected, actualManifestSHA)
	}
	entries, err := parseManifest(data)
	if err != nil {
		return "", err
	}
	actualFiles, err := regularFileHashes(root)
	if err != nil {
		return "", err
	}
	if len(entries) != len(actualFiles) {
		return "", fmt.Errorf("SOURCE_MANIFEST_COVERAGE_MISMATCH: manifest=%d files=%d", len(entries), len(actualFiles))
	}
	for _, entry := range entries {
		actual, ok := actualFiles[entry.Path]
		if !ok {
			return "", fmt.Errorf("SOURCE_MANIFEST_MISSING_FILE: %s", entry.Path)
		}
		if actual != entry.SHA {
			return "", fmt.Errorf("SOURCE_FILE_SHA256_MISMATCH: %s", entry.Path)
		}
	}
	return actualManifestSHA, nil
}

func localSourceDigest(root string) (string, error) {
	files, err := regularFileHashes(root)
	if err != nil {
		return "", err
	}
	manifest := canonicalManifest(files)
	return "sha256:" + shaHex(manifest), nil
}

func copyRegularFile(source, target string, mode os.FileMode) error {
	data, err := os.ReadFile(source)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return err
	}
	return os.WriteFile(target, data, mode)
}

func copyRegularTree(source, target string) error {
	return filepath.WalkDir(source, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		rel, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		if rel == "." {
			return os.MkdirAll(target, 0o755)
		}
		destination := filepath.Join(target, rel)
		if entry.IsDir() {
			return os.MkdirAll(destination, 0o755)
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("SOURCE_SPECIAL_FILE_FORBIDDEN: %s", path)
		}
		return copyRegularFile(path, destination, info.Mode().Perm())
	})
}

func ensureEmptyOutput(path string) error {
	abs, err := filepath.Abs(path)
	if err != nil {
		return err
	}
	entries, err := os.ReadDir(abs)
	if err == nil && len(entries) != 0 {
		return fmt.Errorf("OUTPUT_NOT_EMPTY: %s", abs)
	}
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	return os.MkdirAll(abs, 0o755)
}

func validateFormalSource(kind, id, policyRef string) error {
	if err := ValidateExactPolicyRef(policyRef); err != nil {
		return err
	}
	switch kind {
	case "actions-artifact":
		if !artifactIDRE.MatchString(id) {
			return fmt.Errorf("SOURCE_ID_INVALID: actions artifact id required")
		}
	case "git-commit":
		if !exactCommitRE.MatchString(id) || id != policyRef {
			return fmt.Errorf("SOURCE_ID_INVALID: git commit must equal policy ref")
		}
	case "release":
		if !releaseIDRE.MatchString(id) || strings.EqualFold(id, "latest") {
			return fmt.Errorf("SOURCE_ID_INVALID: exact release tag required")
		}
	default:
		return fmt.Errorf("SOURCE_KIND_INVALID: %s", kind)
	}
	return nil
}

func RunLocalIntakeCLI(args []string, stdout, stderr io.Writer) error {
	fs := newFlagSet("intake", stderr)
	sourceDir := fs.String("source-dir", "", "materialized artifact or local policy source")
	sourceKind := fs.String("source-kind", "", "actions-artifact, git-commit, release, or local-experiment")
	sourceID := fs.String("source-id", "", "immutable source identity")
	sourceSHA := fs.String("source-sha256", "", "expected SHA-256 of SHA256SUMS or local source tree")
	policyRef := fs.String("policy-ref", "", "exact policy commit; omitted for local-experiment")
	policySHA := fs.String("policy-sha256", "", "expected policy bundle SHA-256")
	policyPath := fs.String("policy-path", "policy", "policy path under source-dir")
	adaptersPath := fs.String("adapters-path", "adapters", "adapter path under source-dir")
	providersPath := fs.String("providers-path", "providers", "provider path under source-dir")
	rulepacksPath := fs.String("rulepacks-path", "rulepacks", "rulepack path under source-dir")
	toolchainsPath := fs.String("toolchains-path", "toolchains", "toolchain lock path under source-dir")
	runtimePath := fs.String("runtime-path", "policyctl", "runtime path under source-dir")
	astGrepPath := fs.String("ast-grep-path", "ast-grep", "ast-grep path under source-dir")
	outDir := fs.String("out-dir", "", "session output directory")
	if err := fs.Parse(args); err != nil {
		return &ExitError{Code: 2, Msg: err.Error()}
	}
	for name, value := range map[string]string{"source-dir": *sourceDir, "source-kind": *sourceKind, "out-dir": *outDir} {
		if err := required(name, value); err != nil {
			return &ExitError{Code: 2, Msg: err.Error()}
		}
	}
	root, err := filepath.Abs(*sourceDir)
	if err != nil {
		return err
	}
	outAbs, err := filepath.Abs(*outDir)
	if err != nil {
		return err
	}
	if pathContains(root, outAbs) || pathContains(outAbs, root) {
		return fmt.Errorf("SOURCE_OUTPUT_OVERLAP")
	}
	if err := ensureEmptyOutput(outAbs); err != nil {
		return err
	}
	*outDir = outAbs
	policySource, err := pathUnder(root, *policyPath)
	if err != nil {
		return err
	}
	adaptersSource, err := pathUnder(root, *adaptersPath)
	if err != nil {
		return err
	}
	providersSource, err := pathUnder(root, *providersPath)
	if err != nil {
		return err
	}
	rulepacksSource, err := pathUnder(root, *rulepacksPath)
	if err != nil {
		return err
	}
	toolchainsSource, err := pathUnder(root, *toolchainsPath)
	if err != nil {
		return err
	}
	astGrepSource, err := pathUnder(root, *astGrepPath)
	if err != nil {
		return err
	}

	bundle, err := LoadBundle(policySource)
	if err != nil {
		return err
	}
	formal := *sourceKind != "local-experiment"
	resolvedSourceSHA := ""
	resolvedPolicyRef := *policyRef
	resolvedSourceID := *sourceID
	var runtimeSource string
	if formal {
		if err := validateFormalSource(*sourceKind, *sourceID, *policyRef); err != nil {
			return err
		}
		if !sha256RE.MatchString(*policySHA) || bundle.Hash != *policySHA {
			return fmt.Errorf("POLICY_HASH_MISMATCH: expected %s got %s", *policySHA, bundle.Hash)
		}
		resolvedSourceSHA, err = verifySourceManifest(root, *sourceSHA)
		if err != nil {
			return err
		}
		runtimeSource, err = pathUnder(root, *runtimePath)
		if err != nil {
			return err
		}
		if info, statErr := os.Stat(runtimeSource); statErr != nil || !info.Mode().IsRegular() {
			return fmt.Errorf("RUNTIME_MISSING: %s", runtimeSource)
		}
	} else {
		resolvedSourceSHA, err = localSourceDigest(root)
		if err != nil {
			return err
		}
		if *sourceSHA != "" && *sourceSHA != resolvedSourceSHA {
			return fmt.Errorf("SOURCE_SHA256_MISMATCH: expected %s got %s", *sourceSHA, resolvedSourceSHA)
		}
		if *policySHA != "" && *policySHA != bundle.Hash {
			return fmt.Errorf("POLICY_HASH_MISMATCH: expected %s got %s", *policySHA, bundle.Hash)
		}
		resolvedPolicyRef = "local-policy-sha256:" + strings.TrimPrefix(bundle.Hash, "sha256:")
		if *policyRef != "" && *policyRef != resolvedPolicyRef {
			return fmt.Errorf("LOCAL_POLICY_REF_MISMATCH: expected %s", resolvedPolicyRef)
		}
		if resolvedSourceID == "" {
			resolvedSourceID = "local-" + strings.TrimPrefix(resolvedSourceSHA, "sha256:")[:16]
		}
		runtimeSource, err = os.Executable()
		if err != nil {
			return err
		}
	}
	for name, path := range map[string]string{
		"ADAPTERS": adaptersSource, "PROVIDERS": providersSource, "RULEPACKS": rulepacksSource, "TOOLCHAINS": toolchainsSource,
	} {
		if info, statErr := os.Stat(path); statErr != nil || !info.IsDir() {
			return fmt.Errorf("%s_MISSING: %s", name, path)
		}
	}
	if info, statErr := os.Stat(astGrepSource); statErr != nil || !info.Mode().IsRegular() {
		return fmt.Errorf("ASTGREP_MISSING: %s", astGrepSource)
	}
	if err := ValidatePolicyRef(resolvedPolicyRef); err != nil {
		return err
	}

	materializedPolicy := filepath.Join(*outDir, "policy")
	materializedAdapters := filepath.Join(*outDir, "adapters")
	materializedProviders := filepath.Join(*outDir, "providers")
	materializedRulepacks := filepath.Join(*outDir, "rulepacks")
	materializedToolchains := filepath.Join(*outDir, "toolchains")
	materializedRuntime := filepath.Join(*outDir, "bin", "policyctl")
	materializedAstGrep := filepath.Join(*outDir, "bin", "ast-grep")
	if err := copyRegularTree(policySource, materializedPolicy); err != nil {
		return err
	}
	if err := copyRegularTree(adaptersSource, materializedAdapters); err != nil {
		return err
	}
	if err := copyRegularTree(providersSource, materializedProviders); err != nil {
		return err
	}
	if err := copyRegularTree(rulepacksSource, materializedRulepacks); err != nil {
		return err
	}
	if err := copyRegularTree(toolchainsSource, materializedToolchains); err != nil {
		return err
	}
	if err := copyRegularFile(runtimeSource, materializedRuntime, 0o755); err != nil {
		return err
	}
	if err := copyRegularFile(astGrepSource, materializedAstGrep, 0o755); err != nil {
		return err
	}
	materializedBundle, err := LoadBundle(materializedPolicy)
	if err != nil {
		return err
	}
	if materializedBundle.Hash != bundle.Hash {
		return fmt.Errorf("MATERIALIZED_POLICY_MISMATCH: %s != %s", materializedBundle.Hash, bundle.Hash)
	}
	runtimeSHA, err := fileSHA(materializedRuntime)
	if err != nil {
		return err
	}
	astGrepSHA, err := fileSHA(materializedAstGrep)
	if err != nil {
		return err
	}
	adaptersSHA, err := localSourceDigest(materializedAdapters)
	if err != nil {
		return err
	}
	providersSHA, err := localSourceDigest(materializedProviders)
	if err != nil {
		return err
	}
	rulepacksSHA, err := localSourceDigest(materializedRulepacks)
	if err != nil {
		return err
	}
	toolchainsSHA, err := localSourceDigest(materializedToolchains)
	if err != nil {
		return err
	}
	receipt, err := finalizeLocalIntakeReceipt(LocalIntakeReceipt{
		Schema:           localIntakeSchema,
		Status:           "PASS",
		SourceKind:       *sourceKind,
		SourceID:         resolvedSourceID,
		SourceSHA256:     resolvedSourceSHA,
		PolicyRef:        resolvedPolicyRef,
		PolicyHash:       bundle.Hash,
		RuntimeSHA256:    runtimeSHA,
		AstGrepSHA256:    astGrepSHA,
		AdaptersSHA256:   adaptersSHA,
		ProvidersSHA256:  providersSHA,
		RulepacksSHA256:  rulepacksSHA,
		ToolchainsSHA256: toolchainsSHA,
		PolicyPath:       "policy",
		AdaptersPath:     "adapters",
		ProvidersPath:    "providers",
		RulepacksPath:    "rulepacks",
		ToolchainsPath:   "toolchains",
		RuntimePath:      "bin/policyctl",
		AstGrepPath:      "bin/ast-grep",
	})
	if err != nil {
		return err
	}
	if err := writeJSON(filepath.Join(*outDir, "intake-receipt.json"), receipt); err != nil {
		return err
	}
	return json.NewEncoder(stdout).Encode(receipt)
}

func decodeLocalTask(path string) (LocalTaskContract, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return LocalTaskContract{}, fmt.Errorf("TASK_CONTRACT_READ_FAILED: %w", err)
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	var task LocalTaskContract
	if err := decoder.Decode(&task); err != nil {
		return LocalTaskContract{}, fmt.Errorf("TASK_CONTRACT_PARSE_FAILED: %w", err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			return LocalTaskContract{}, fmt.Errorf("TASK_CONTRACT_PARSE_FAILED: trailing JSON")
		}
		return LocalTaskContract{}, fmt.Errorf("TASK_CONTRACT_PARSE_FAILED: %w", err)
	}
	return task, nil
}

func normalizeLocalTask(task LocalTaskContract, bundle *Bundle) (LocalTaskContract, Profile, error) {
	if task.Schema != localTaskSchema || !localIDRE.MatchString(task.TaskID) {
		return LocalTaskContract{}, Profile{}, fmt.Errorf("TASK_CONTRACT_INVALID: schema/taskId")
	}
	profile, ok := findProfile(bundle, task.ProfileID)
	if !ok || profile.Language != task.Language {
		return LocalTaskContract{}, Profile{}, fmt.Errorf("TASK_PROFILE_INVALID: %s/%s", task.Language, task.ProfileID)
	}
	if len(task.Scope) == 0 {
		return LocalTaskContract{}, Profile{}, fmt.Errorf("TASK_SCOPE_REQUIRED")
	}
	scopeSeen := map[string]bool{}
	for i, value := range task.Scope {
		clean, err := cleanRelative(value)
		if err != nil {
			return LocalTaskContract{}, Profile{}, err
		}
		if scopeSeen[clean] {
			return LocalTaskContract{}, Profile{}, fmt.Errorf("TASK_SCOPE_DUPLICATE: %s", clean)
		}
		scopeSeen[clean] = true
		task.Scope[i] = clean
	}
	sort.Strings(task.Scope)
	if len(task.Tests) == 0 {
		return LocalTaskContract{}, Profile{}, fmt.Errorf("TASK_TEST_REQUIRED")
	}
	testSeen := map[string]bool{}
	for i := range task.Tests {
		test := &task.Tests[i]
		if !localIDRE.MatchString(test.ID) || testSeen[test.ID] || len(test.Command) == 0 {
			return LocalTaskContract{}, Profile{}, fmt.Errorf("TASK_TEST_INVALID: %s", test.ID)
		}
		testSeen[test.ID] = true
		if test.TimeoutSeconds == 0 {
			test.TimeoutSeconds = 120
		}
		if test.TimeoutSeconds < 1 || test.TimeoutSeconds > 1800 {
			return LocalTaskContract{}, Profile{}, fmt.Errorf("TASK_TEST_TIMEOUT_INVALID: %s", test.ID)
		}
	}
	sort.Slice(task.Tests, func(i, j int) bool { return task.Tests[i].ID < task.Tests[j].ID })
	return task, profile, nil
}

func directoryTreeRef(root string) (string, error) {
	files := map[string]string{}
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			if entry.Name() == ".git" {
				return filepath.SkipDir
			}
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		info, err := os.Lstat(path)
		if err != nil {
			return err
		}
		switch {
		case info.Mode().IsRegular():
			sha, err := fileSHA(path)
			if err != nil {
				return err
			}
			files[rel] = fmt.Sprintf("file\x00%o\x00%d\x00%s", info.Mode().Perm(), info.Size(), sha)
		case info.Mode()&os.ModeSymlink != 0:
			target, err := os.Readlink(path)
			if err != nil {
				return err
			}
			files[rel] = "symlink\x00" + target
		default:
			return fmt.Errorf("WORKSPACE_SPECIAL_FILE_FORBIDDEN: %s", rel)
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	paths := make([]string, 0, len(files))
	for p := range files {
		paths = append(paths, p)
	}
	sort.Strings(paths)
	var lines strings.Builder
	lines.WriteString("shiftleft-directory-tree/1\n")
	for _, p := range paths {
		fmt.Fprintf(&lines, "%s\x00%s\n", p, files[p])
	}
	return "sha256-tree:" + shaHex([]byte(lines.String())), nil
}

func workspaceTreeRefs(root string) (string, string, string, error) {
	abs, err := filepath.Abs(root)
	if err != nil {
		return "", "", "", err
	}
	cmd := exec.Command("git", "-C", abs, "rev-parse", "--is-inside-work-tree")
	out, gitErr := cmd.Output()
	if gitErr == nil && strings.TrimSpace(string(out)) == "true" {
		base, candidate, err := WorktreeTreeRefs(abs)
		return "git", base, candidate, err
	}
	if _, statErr := os.Lstat(filepath.Join(abs, ".git")); statErr == nil {
		return "", "", "", fmt.Errorf("GIT_WORKTREE_INSPECTION_FAILED: %w", gitErr)
	}
	candidate, err := directoryTreeRef(abs)
	if err != nil {
		return "", "", "", err
	}
	return "directory", candidate, candidate, nil
}

func scopeDigest(workspace string, scope []string) (string, error) {
	var lines strings.Builder
	lines.WriteString("shiftleft-local-scope/1\n")
	for _, rel := range scope {
		path, err := pathUnder(workspace, rel)
		if err != nil {
			return "", err
		}
		info, err := os.Stat(path)
		if err != nil || !info.Mode().IsRegular() {
			return "", fmt.Errorf("TASK_SCOPE_FILE_INVALID: %s", rel)
		}
		sha, err := fileSHA(path)
		if err != nil {
			return "", err
		}
		fmt.Fprintf(&lines, "%s\x00%s\n", rel, sha)
	}
	return "sha256:" + shaHex([]byte(lines.String())), nil
}

func observeLocalSource(bundle *Bundle, profile Profile, workspace, rel, packageID, contractDigest string) (Observation, error) {
	path, err := pathUnder(workspace, rel)
	if err != nil {
		return Observation{}, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return Observation{}, err
	}
	base := Observation{
		Schema:       "shiftleft-observation/1",
		RuleID:       profile.RuleID,
		ProfileID:    profile.ID,
		PackageID:    packageID,
		Language:     profile.Language,
		Required:     profile.Required,
		FixtureKind:  "workspace",
		CaseID:       "source:" + rel,
		SourcePath:   rel,
		SourceSHA256: "sha256:" + shaHex(data),
		ConfigSHA256: "",
		Evidence:     []Evidence{},
	}
	base.ConfigSHA256, err = profileConfigSHA256(bundle, profile, []byte(profile.ID+"\n"+rel+"\n"+contractDigest+"\n"))
	if err != nil {
		return providerFailure(base, err)
	}
	report, tool, err := runStructureAdapter(bundle, profile, path)
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
	base.Tool = tool
	forbidden := forbiddenSet(profile.ForbiddenImports)
	hits := []ImportFinding{}
	for _, item := range report.Imports {
		if forbidden[item.Module] {
			hits = append(hits, item)
		}
	}
	if len(hits) == 0 {
		base.Status = StatusMet
		base.FindingCode = "core-import-boundary-clean"
		base.Evidence = []Evidence{{Kind: "import-scan", Path: rel, Detail: fmt.Sprintf("%d imports; no forbidden effect adapter", len(report.Imports))}}
	} else {
		base.Status = StatusUnmet
		base.FindingCode = "core-imports-effect-adapter"
		for _, hit := range hits {
			base.Evidence = append(base.Evidence, Evidence{Kind: "forbidden-import", Path: rel, Line: hit.Line, Detail: hit.Module})
		}
	}
	return finalizeObservation(base)
}

func localTestToolIdentity(tool string) (ToolIdentity, error) {
	version, err := normalizeToolVersion(tool)
	if err != nil {
		return ToolIdentity{}, err
	}
	digest := "sha256:" + shaHex([]byte("shiftleft-local-test-tool/1\n"+tool+"\n"+version+"\n"))
	return ToolIdentity{Name: tool, Version: version, AdapterSHA256: "native-test", Digest: digest}, nil
}

func sanitizeID(value string) string {
	return regexp.MustCompile(`[^A-Za-z0-9._-]+`).ReplaceAllString(value, "_")
}

func runLocalTest(workspace, diagnostics string, test LocalTest, packageID, language string) (LocalTestResult, Observation, error) {
	result := LocalTestResult{ID: test.ID, Command: append([]string(nil), test.Command...), ExitCode: -1}
	config, _ := json.Marshal(test)
	observation := Observation{
		Schema:       "shiftleft-observation/1",
		RuleID:       "SL-TEST-001",
		ProfileID:    "internal.native-test",
		PackageID:    packageID,
		Language:     language,
		Required:     true,
		FixtureKind:  "workspace",
		CaseID:       "test:" + test.ID,
		ConfigSHA256: "sha256:" + shaHex(config),
		Evidence:     []Evidence{},
	}
	tool, err := localTestToolIdentity(test.Command[0])
	if err != nil {
		result.Status = "unobserved"
		observation.Status = StatusUnobserved
		observation.FindingCode = "required-tool-missing"
		observation.Evidence = []Evidence{{Kind: "native-test", Detail: err.Error()}}
		finalized, finalizeErr := finalizeObservation(observation)
		return result, finalized, finalizeErr
	}
	result.Tool = tool
	observation.Tool = tool

	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(test.TimeoutSeconds)*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, test.Command[0], test.Command[1:]...)
	cmd.Dir = workspace
	tempHome, err := os.MkdirTemp("", "shiftleft-local-test-home-")
	if err != nil {
		return LocalTestResult{}, Observation{}, err
	}
	defer os.RemoveAll(tempHome)
	cmd.Env = append(os.Environ(),
		"HOME="+tempHome,
		"GOCACHE="+filepath.Join(tempHome, "go-cache"),
		"PYTHONDONTWRITEBYTECODE=1",
		"LC_ALL=C",
		"TZ=UTC",
		"SHIFTLEFT_LOCAL=1",
	)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	runErr := cmd.Run()
	if err := os.MkdirAll(diagnostics, 0o755); err != nil {
		return LocalTestResult{}, Observation{}, err
	}
	name := sanitizeID(test.ID)
	if err := os.WriteFile(filepath.Join(diagnostics, name+".stdout"), stdout.Bytes(), 0o644); err != nil {
		return LocalTestResult{}, Observation{}, err
	}
	if err := os.WriteFile(filepath.Join(diagnostics, name+".stderr"), stderr.Bytes(), 0o644); err != nil {
		return LocalTestResult{}, Observation{}, err
	}
	commandText := strings.Join(test.Command, " ")
	switch {
	case runErr == nil:
		result.Status = "pass"
		result.ExitCode = 0
		observation.Status = StatusMet
		observation.FindingCode = "native-test-pass"
		observation.Evidence = []Evidence{{Kind: "native-test", Detail: commandText + " exit=0"}}
	case ctx.Err() == context.DeadlineExceeded:
		result.Status = "unobserved"
		observation.Status = StatusUnobserved
		observation.FindingCode = "required-test-timeout"
		observation.Evidence = []Evidence{{Kind: "native-test", Detail: commandText + " timed out"}}
	default:
		result.Status = "fail"
		observation.Status = StatusUnmet
		observation.FindingCode = "native-test-failed"
		var exitErr *exec.ExitError
		if errors.As(runErr, &exitErr) {
			result.ExitCode = exitErr.ExitCode()
		}
		observation.Evidence = []Evidence{{Kind: "native-test", Detail: fmt.Sprintf("%s exit=%d", commandText, result.ExitCode)}}
	}
	finalized, err := finalizeObservation(observation)
	return result, finalized, err
}

func routeBindingObservation(task LocalTaskContract) (Observation, error) {
	tests := map[string]bool{}
	for _, test := range task.Tests {
		tests[test.ID] = true
	}
	missing := []string{}
	for _, public := range task.Package.PublicContracts {
		for _, route := range append(append([]Route(nil), public.GoldenRoutes...), public.NegativeRoutes...) {
			if !tests[route.Fixture] {
				missing = append(missing, public.ID+"/"+route.ID+"->"+route.Fixture)
			}
		}
	}
	status, code := StatusMet, "route-tests-bound"
	evidence := []Evidence{{Kind: "route-test", Detail: "every golden and negative route maps to an executed native test"}}
	if len(missing) > 0 {
		sort.Strings(missing)
		status, code = StatusUnmet, "route-test-missing"
		evidence = []Evidence{{Kind: "route-test", Detail: strings.Join(missing, ",")}}
	}
	return internalObservation("SL-GOLDEN-001", task.Package.PackageID, status, code, true, evidence)
}

func toolchainDigest(observations []Observation) string {
	set := map[string]bool{}
	for _, observation := range observations {
		if observation.Tool.Digest != "" {
			set[observation.Tool.Digest] = true
		} else if observation.Tool.Name != "" {
			set["missing:"+observation.Tool.Name] = true
		}
	}
	values := make([]string, 0, len(set))
	for value := range set {
		values = append(values, value)
	}
	sort.Strings(values)
	return "sha256:" + shaHex([]byte("shiftleft-local-toolchain/1\n"+strings.Join(values, "\n")+"\n"))
}

func pathContains(parent, child string) bool {
	parentAbs, err1 := filepath.Abs(parent)
	childAbs, err2 := filepath.Abs(child)
	if err1 != nil || err2 != nil {
		return false
	}
	return childAbs == parentAbs || strings.HasPrefix(childAbs, parentAbs+string(os.PathSeparator))
}

func loadLocalSession(session string) (LocalIntakeReceipt, *Bundle, error) {
	data, err := os.ReadFile(filepath.Join(session, "intake-receipt.json"))
	if err != nil {
		return LocalIntakeReceipt{}, nil, fmt.Errorf("INTAKE_RECEIPT_READ_FAILED: %w", err)
	}
	var receipt LocalIntakeReceipt
	if err := json.Unmarshal(data, &receipt); err != nil {
		return LocalIntakeReceipt{}, nil, fmt.Errorf("INTAKE_RECEIPT_PARSE_FAILED: %w", err)
	}
	if err := validateLocalIntakeReceipt(receipt); err != nil {
		return LocalIntakeReceipt{}, nil, err
	}
	if err := ValidatePolicyRef(receipt.PolicyRef); err != nil {
		return LocalIntakeReceipt{}, nil, err
	}
	policyPath, err := pathUnder(session, receipt.PolicyPath)
	if err != nil {
		return LocalIntakeReceipt{}, nil, err
	}
	bundle, err := LoadBundle(policyPath)
	if err != nil {
		return LocalIntakeReceipt{}, nil, err
	}
	if bundle.Hash != receipt.PolicyHash {
		return LocalIntakeReceipt{}, nil, fmt.Errorf("SESSION_POLICY_HASH_MISMATCH: expected %s got %s", receipt.PolicyHash, bundle.Hash)
	}
	runtimePath, err := pathUnder(session, receipt.RuntimePath)
	if err != nil {
		return LocalIntakeReceipt{}, nil, err
	}
	runtimeSHA, err := fileSHA(runtimePath)
	if err != nil {
		return LocalIntakeReceipt{}, nil, err
	}
	if runtimeSHA != receipt.RuntimeSHA256 {
		return LocalIntakeReceipt{}, nil, fmt.Errorf("SESSION_RUNTIME_HASH_MISMATCH: expected %s got %s", receipt.RuntimeSHA256, runtimeSHA)
	}
	executable, err := os.Executable()
	if err != nil {
		return LocalIntakeReceipt{}, nil, err
	}
	executableSHA, err := fileSHA(executable)
	if err != nil {
		return LocalIntakeReceipt{}, nil, err
	}
	if executableSHA != receipt.RuntimeSHA256 {
		return LocalIntakeReceipt{}, nil, fmt.Errorf("RUNNING_RUNTIME_HASH_MISMATCH: expected %s got %s", receipt.RuntimeSHA256, executableSHA)
	}
	astGrepPath, err := pathUnder(session, receipt.AstGrepPath)
	if err != nil {
		return LocalIntakeReceipt{}, nil, err
	}
	astGrepSHA, err := fileSHA(astGrepPath)
	if err != nil || astGrepSHA != receipt.AstGrepSHA256 {
		return LocalIntakeReceipt{}, nil, fmt.Errorf("SESSION_ASTGREP_HASH_MISMATCH: expected %s got %s", receipt.AstGrepSHA256, astGrepSHA)
	}
	for name, spec := range map[string]struct{ path, expected string }{
		"ADAPTERS":   {receipt.AdaptersPath, receipt.AdaptersSHA256},
		"PROVIDERS":  {receipt.ProvidersPath, receipt.ProvidersSHA256},
		"RULEPACKS":  {receipt.RulepacksPath, receipt.RulepacksSHA256},
		"TOOLCHAINS": {receipt.ToolchainsPath, receipt.ToolchainsSHA256},
	} {
		dir, pathErr := pathUnder(session, spec.path)
		if pathErr != nil {
			return LocalIntakeReceipt{}, nil, pathErr
		}
		actual, digestErr := localSourceDigest(dir)
		if digestErr != nil || actual != spec.expected {
			return LocalIntakeReceipt{}, nil, fmt.Errorf("SESSION_%s_HASH_MISMATCH: expected %s got %s", name, spec.expected, actual)
		}
	}
	return receipt, bundle, nil
}

func RunLocalRunCLI(args []string, stdout, stderr io.Writer) error {
	fs := newFlagSet("run", stderr)
	session := fs.String("session", "", "intake session directory")
	workspace := fs.String("workspace", "", "local candidate workspace")
	contractPath := fs.String("contract", "", "local task contract JSON")
	outDir := fs.String("out-dir", "", "completion output directory")
	if err := fs.Parse(args); err != nil {
		return &ExitError{Code: 2, Msg: err.Error()}
	}
	for name, value := range map[string]string{"session": *session, "workspace": *workspace, "contract": *contractPath, "out-dir": *outDir} {
		if err := required(name, value); err != nil {
			return &ExitError{Code: 2, Msg: err.Error()}
		}
	}
	if pathContains(*workspace, *outDir) || pathContains(*workspace, *session) {
		return fmt.Errorf("OUTPUT_OR_SESSION_INSIDE_WORKSPACE")
	}
	if err := ensureEmptyOutput(*outDir); err != nil {
		return err
	}
	intake, bundle, err := loadLocalSession(*session)
	if err != nil {
		return err
	}
	task, err := decodeLocalTask(*contractPath)
	if err != nil {
		return err
	}
	task, profile, err := normalizeLocalTask(task, bundle)
	if err != nil {
		return err
	}
	taskDigest, err := digestWithPrefix(localTaskSchema, task)
	if err != nil {
		return err
	}
	workspaceAbs, err := filepath.Abs(*workspace)
	if err != nil {
		return err
	}
	kind, baseTree, candidateTree, err := workspaceTreeRefs(workspaceAbs)
	if err != nil {
		return err
	}
	scopeSHA, err := scopeDigest(workspaceAbs, task.Scope)
	if err != nil {
		return err
	}

	scoped := *bundle
	scoped.Contracts = []PackageContract{task.Package}
	scoped.Profiles = []Profile{profile}
	observations := []Observation{}
	for _, rel := range task.Scope {
		observation, err := observeLocalSource(&scoped, profile, workspaceAbs, rel, task.Package.PackageID, taskDigest)
		if err != nil {
			return err
		}
		observations = append(observations, observation)
	}
	contractObservations, err := ContractObservations(&scoped)
	if err != nil {
		return err
	}
	observations = append(observations, contractObservations...)
	routeObservation, err := routeBindingObservation(task)
	if err != nil {
		return err
	}
	observations = append(observations, routeObservation)

	testResults := []LocalTestResult{}
	for _, test := range task.Tests {
		result, observation, err := runLocalTest(workspaceAbs, filepath.Join(*outDir, "diagnostics"), test, task.Package.PackageID, task.Language)
		if err != nil {
			return err
		}
		testResults = append(testResults, result)
		observations = append(observations, observation)
	}
	_, _, observedCandidate, err := workspaceTreeRefs(workspaceAbs)
	if err != nil {
		return err
	}
	if err := writeJSONL(filepath.Join(*outDir, "observations.jsonl"), observations); err != nil {
		return err
	}
	if err := writeJSON(filepath.Join(*outDir, "tests.json"), testResults); err != nil {
		return err
	}

	completion := LocalCompletionReceipt{
		Schema:                localCompletionSchema,
		Status:                "DRAFT",
		TerminalState:         "CANDIDATE_DRIFT",
		IntakeReceiptDigest:   intake.ReceiptDigest,
		SourceKind:            intake.SourceKind,
		SourceID:              intake.SourceID,
		SourceSHA256:          intake.SourceSHA256,
		PolicyRef:             intake.PolicyRef,
		PolicyHash:            intake.PolicyHash,
		TaskID:                task.TaskID,
		TaskContractDigest:    taskDigest,
		WorkspaceKind:         kind,
		BaseTree:              baseTree,
		CandidateTree:         candidateTree,
		ObservedCandidateTree: observedCandidate,
		ScopeDigest:           scopeSHA,
		ToolchainDigest:       toolchainDigest(observations),
		ObservationRootDigest: observationRoot(observations),
		Tests:                 testResults,
	}
	if observedCandidate == candidateTree {
		admissionReceipt, err := Admit(&scoped, intake.PolicyRef, intake.PolicyHash, baseTree, candidateTree, observations)
		if err != nil {
			return err
		}
		completion.Admission = &admissionReceipt
		completion.TerminalState = admissionReceipt.TerminalState
		if admissionReceipt.Verdict == "PASS" {
			completion.Status = "COMPLETE"
			completion.TerminalState = "PASS"
		}
	}
	completion, err = finalizeLocalCompletionReceipt(completion)
	if err != nil {
		return err
	}
	if err := writeJSON(filepath.Join(*outDir, "completion-receipt.json"), completion); err != nil {
		return err
	}
	if err := json.NewEncoder(stdout).Encode(completion); err != nil {
		return err
	}
	if completion.Status != "COMPLETE" {
		return &ExitError{Code: 3, Msg: completion.TerminalState}
	}
	return nil
}
