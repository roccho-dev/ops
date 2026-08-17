package forge

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type InitOptions struct {
	Root string
}

type AddOptions struct {
	Root    string
	ID      string
	Title   string
	Purpose string
	Message string
}

func InitWorkspace(options InitOptions) error {
	root := options.Root
	if root == "" {
		root = "."
	}
	entries, err := os.ReadDir(root)
	if err == nil && len(entries) > 0 {
		return fmt.Errorf("init target is not empty: %s", root)
	}
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := os.MkdirAll(root, 0o755); err != nil {
		return err
	}
	files := map[string]string{
		"go.mod":     "module capabilities.local/workspace\n\ngo 1.23\n",
		"README.md":  "# Capability workspace\n\n`capforge add`で意思決定主張とGo実装directoryを追加し、`capforge project`でdistを再生成します。\n",
		".gitignore": "dist/\n.capforge/tmp/\n.capforge/cache/\n",
	}
	for rel, content := range files {
		if err := writeFile(filepath.Join(root, rel), []byte(content), 0o644); err != nil {
			return err
		}
	}
	return AddCapability(AddOptions{
		Root: root, ID: "go-hello", Title: "Go Hello", Purpose: "Go native capabilityの最小例", Message: "Hello from Go capability",
	})
}

func AddCapability(options AddOptions) error {
	root := options.Root
	if root == "" {
		root = "."
	}
	if !validID(options.ID) {
		return fmt.Errorf("invalid capability id: %q", options.ID)
	}
	if options.Title == "" {
		options.Title = options.ID
	}
	if options.Purpose == "" {
		options.Purpose = options.Title
	}
	if options.Message == "" {
		options.Message = options.Title
	}
	decisionPath := filepath.Join(root, "decisions", options.ID+".jsonl")
	capDir := filepath.Join(root, "capabilities", options.ID)
	if _, err := os.Stat(decisionPath); err == nil {
		return fmt.Errorf("decision already exists: %s", decisionPath)
	}
	if _, err := os.Stat(capDir); err == nil {
		return fmt.Errorf("capability directory already exists: %s", capDir)
	}
	claim := DecisionClaim{
		Schema: DecisionSchema, ID: options.ID, Action: "adopt", Title: options.Title,
		Purpose: options.Purpose, Execution: "local", Effects: []string{"stdout"}, Tags: []string{"go", "native"},
	}
	claimJSON, err := json.Marshal(claim)
	if err != nil {
		return err
	}
	if err := writeFile(decisionPath, append(claimJSON, '\n'), 0o644); err != nil {
		return err
	}
	mainSource := fmt.Sprintf("package main\n\nimport \"fmt\"\n\nfunc main() {\n\tfmt.Println(%q)\n}\n", options.Message)
	fixture := Fixture{Schema: FixtureSchema, Args: []string{}, Stdin: "", Stdout: options.Message + "\n", Stderr: "", ExitCode: 0, TimeoutMS: 2000}
	if err := writeFile(filepath.Join(capDir, "main.go"), []byte(mainSource), 0o644); err != nil {
		return err
	}
	return writeJSON(filepath.Join(capDir, "fixture.json"), fixture)
}

func loadDecisions(root string) (map[string]DecisionClaim, []DecisionClaim, error) {
	decisionDir := filepath.Join(root, "decisions")
	entries, err := os.ReadDir(decisionDir)
	if errors.Is(err, os.ErrNotExist) {
		return map[string]DecisionClaim{}, nil, nil
	}
	if err != nil {
		return nil, nil, err
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })
	latest := map[string]DecisionClaim{}
	var all []DecisionClaim
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".jsonl") {
			continue
		}
		fileID := strings.TrimSuffix(entry.Name(), ".jsonl")
		if !validID(fileID) {
			return nil, nil, fmt.Errorf("invalid decision filename %q", entry.Name())
		}
		claims, err := readJSONLFile[DecisionClaim](filepath.Join(decisionDir, entry.Name()))
		if err != nil {
			return nil, nil, err
		}
		for _, claim := range claims {
			if claim.ID != fileID {
				return nil, nil, fmt.Errorf("%s: claim id %q must match filename", entry.Name(), claim.ID)
			}
			if claim.Schema != DecisionSchema {
				return nil, nil, fmt.Errorf("%s: unsupported decision schema %q", entry.Name(), claim.Schema)
			}
			if !validID(claim.ID) {
				return nil, nil, fmt.Errorf("%s: invalid id %q", entry.Name(), claim.ID)
			}
			if claim.Action != "adopt" && claim.Action != "retire" {
				return nil, nil, fmt.Errorf("%s: invalid action %q", entry.Name(), claim.Action)
			}
			claim.At = normalizeAt(claim.ID, claim.At)
			if claim.Execution == "" {
				claim.Execution = "local"
			}
			all = append(all, claim)
			latest[claim.ID] = claim
		}
	}
	sort.SliceStable(all, func(i, j int) bool { return all[i].ID < all[j].ID })
	return latest, all, nil
}

func implementationDirs(root string) (map[string]string, error) {
	base := filepath.Join(root, "capabilities")
	entries, err := os.ReadDir(base)
	if errors.Is(err, os.ErrNotExist) {
		return map[string]string{}, nil
	}
	if err != nil {
		return nil, err
	}
	result := map[string]string{}
	for _, entry := range entries {
		if !entry.IsDir() || !validID(entry.Name()) {
			continue
		}
		result[entry.Name()] = filepath.Join(base, entry.Name())
	}
	return result, nil
}
