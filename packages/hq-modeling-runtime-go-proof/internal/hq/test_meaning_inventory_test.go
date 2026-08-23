package hq

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"testing"
)

type testMeaningInventoryRow struct {
	Schema      string   `json:"schema"`
	ID          string   `json:"id"`
	Disposition string   `json:"disposition"`
	GoTests     []string `json:"goTests"`
	Source      struct {
		File        string `json:"file"`
		AssertLines []int  `json:"assertLines"`
		AssertCount int    `json:"assertCount"`
		TestLines   []int  `json:"testLines"`
		SHA256      string `json:"sha256"`
		Range       struct {
			Start int `json:"start"`
			End   int `json:"end"`
		} `json:"range"`
	} `json:"source"`
}

func proofRepoRootForTest(t *testing.T) string {
	t.Helper()
	_, current, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	return filepath.Clean(filepath.Join(filepath.Dir(current), "..", "..", "..", ".."))
}

func readTestMeaningInventory(t *testing.T, dir string) []testMeaningInventoryRow {
	t.Helper()
	paths, err := filepath.Glob(filepath.Join(dir, "*.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	if len(paths) != 16 {
		t.Fatalf("inventory shards=%d, want 16", len(paths))
	}
	sort.Strings(paths)
	rows := []testMeaningInventoryRow{}
	for _, path := range paths {
		file, err := os.Open(path)
		if err != nil {
			t.Fatal(err)
		}
		scanner := bufio.NewScanner(file)
		scanner.Buffer(make([]byte, 64*1024), 4*1024*1024)
		for line := 1; scanner.Scan(); line++ {
			var row testMeaningInventoryRow
			if err := json.Unmarshal(scanner.Bytes(), &row); err != nil {
				file.Close()
				t.Fatalf("%s line %d: %v", filepath.Base(path), line, err)
			}
			rows = append(rows, row)
		}
		if err := scanner.Err(); err != nil {
			file.Close()
			t.Fatal(err)
		}
		if err := file.Close(); err != nil {
			t.Fatal(err)
		}
	}
	return rows
}

func TestCanonicalMJSMeaningInventoryIsComplete(t *testing.T) {
	repoRoot := proofRepoRootForTest(t)
	inventoryDir := filepath.Join(repoRoot, "packages", "hq-modeling-runtime-go-proof", "test-meaning.inventory")
	nodeTestRoot := filepath.Join(repoRoot, "packages", "hq-modeling-runtime", "tests")
	rows := readTestMeaningInventory(t, inventoryDir)

	if len(rows) != 154 {
		t.Fatalf("meaning groups=%d, want 154", len(rows))
	}

	assertPattern := regexp.MustCompile(`\bassert\.(equal|deepEqual|notStrictEqual|match|ok|throws|doesNotThrow|notEqual|fail)\s*\(`)
	goTestPattern := regexp.MustCompile(`(?m)^func (Test[[:alnum:]_]+)\s*\(`)
	allowedDispositions := map[string]bool{
		"ported-required":             true,
		"selective-port":              true,
		"retained-node-only":          true,
		"deferred-outside-proof":      true,
		"canonical-node-package-only": true,
		"retained-existing-parity":    true,
	}

	goTestNames := map[string]bool{}
	goTestFiles, err := filepath.Glob(filepath.Join(filepath.Dir(inventoryDir), "internal", "hq", "*_test.go"))
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range goTestFiles {
		content, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		for _, match := range goTestPattern.FindAllSubmatch(content, -1) {
			goTestNames[string(match[1])] = true
		}
	}

	actualAssertions := map[string]map[int]bool{}
	nodeFiles, err := filepath.Glob(filepath.Join(nodeTestRoot, "*.mjs"))
	if err != nil {
		t.Fatal(err)
	}
	if len(nodeFiles) != 16 {
		t.Fatalf("canonical MJS files=%d, want 16", len(nodeFiles))
	}
	for _, path := range nodeFiles {
		content, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		file := filepath.Base(path)
		actualAssertions[file] = map[int]bool{}
		for index, text := range strings.Split(string(content), "\n") {
			if assertPattern.MatchString(text) {
				actualAssertions[file][index+1] = true
			}
		}
	}

	ids := map[string]bool{}
	covered := map[string]map[int][]string{}
	representedFiles := map[string]bool{}
	for _, row := range rows {
		if row.Schema != "hq.modelingRuntime.goTestMeaning.v1" {
			t.Fatalf("%s schema=%q", row.ID, row.Schema)
		}
		if row.ID == "" || ids[row.ID] {
			t.Fatalf("duplicate/empty inventory id %q", row.ID)
		}
		ids[row.ID] = true
		if !allowedDispositions[row.Disposition] {
			t.Fatalf("%s unknown disposition %q", row.ID, row.Disposition)
		}
		if row.Source.Range.Start <= 0 || row.Source.Range.End < row.Source.Range.Start || len(row.Source.TestLines) == 0 {
			t.Fatalf("%s invalid source range/test lines", row.ID)
		}
		if row.Source.AssertCount != len(row.Source.AssertLines) {
			t.Fatalf("%s assertCount=%d lines=%d", row.ID, row.Source.AssertCount, len(row.Source.AssertLines))
		}
		path := filepath.Join(nodeTestRoot, row.Source.File)
		content, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("%s source: %v", row.ID, err)
		}
		digest := sha256.Sum256(content)
		if hex.EncodeToString(digest[:]) != row.Source.SHA256 {
			t.Fatalf("%s stale source digest for %s", row.ID, row.Source.File)
		}
		representedFiles[row.Source.File] = true
		if covered[row.Source.File] == nil {
			covered[row.Source.File] = map[int][]string{}
		}
		for _, line := range row.Source.AssertLines {
			if line < row.Source.Range.Start || line > row.Source.Range.End {
				t.Fatalf("%s assertion line %d outside range", row.ID, line)
			}
			if !actualAssertions[row.Source.File][line] {
				t.Fatalf("%s references non-assertion %s:%d", row.ID, row.Source.File, line)
			}
			covered[row.Source.File][line] = append(covered[row.Source.File][line], row.ID)
		}
		if row.Disposition == "ported-required" || row.Disposition == "selective-port" {
			if len(row.GoTests) == 0 {
				t.Fatalf("%s is %s without Go tests", row.ID, row.Disposition)
			}
			for _, name := range row.GoTests {
				if !goTestNames[name] {
					t.Fatalf("%s references missing Go test %s", row.ID, name)
				}
			}
		}
	}

	if len(representedFiles) != 16 {
		files := make([]string, 0, len(representedFiles))
		for file := range representedFiles {
			files = append(files, file)
		}
		sort.Strings(files)
		t.Fatalf("represented MJS files=%d, want 16: %v", len(representedFiles), files)
	}

	assertionCount := 0
	for file, lines := range actualAssertions {
		for line := range lines {
			assertionCount++
			owners := covered[file][line]
			if len(owners) != 1 {
				t.Fatalf("assertion %s:%d inventory owners=%v, want exactly one", file, line, owners)
			}
		}
	}
	if assertionCount != 540 {
		t.Fatalf("canonical assertion sites=%d, want 540", assertionCount)
	}

	// Make the two deliberately RED meanings impossible to accidentally remove
	// from the inventory while leaving the suite superficially green.
	for _, required := range []string{
		"promotion.success-linkage-detachment",
		"proposal.deep-nesting-resource-safety",
	} {
		if !ids[required] {
			t.Fatal(fmt.Sprintf("missing required RED meaning %s", required))
		}
	}
}
