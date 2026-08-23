package hq

import (
	"bufio"
	"encoding/json"
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

func packageRootForTest(t *testing.T) string {
	t.Helper()
	_, current, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	return filepath.Clean(filepath.Join(filepath.Dir(current), "..", ".."))
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

func TestCanonicalTestMeaningInventoryIsComplete(t *testing.T) {
	root := packageRootForTest(t)
	rows := readTestMeaningInventory(t, filepath.Join(root, "test-meaning.inventory"))
	if len(rows) != 154 {
		t.Fatalf("meaning groups=%d, want 154", len(rows))
	}

	goTestPattern := regexp.MustCompile(`(?m)^func (Test[[:alnum:]_]+)\s*\(`)
	shaPattern := regexp.MustCompile(`^[0-9a-f]{64}$`)
	allowedDispositions := map[string]bool{
		"ported-required":             true,
		"selective-port":              true,
		"retained-node-only":          true,
		"deferred-outside-proof":      true,
		"canonical-node-package-only": true,
		"retained-existing-parity":    true,
	}

	goTestNames := map[string]bool{}
	goTestFiles, err := filepath.Glob(filepath.Join(root, "internal", "hq", "*_test.go"))
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

	ids := map[string]bool{}
	representedFiles := map[string]bool{}
	assertionCount := 0
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
		if row.Source.File == "" || !shaPattern.MatchString(row.Source.SHA256) {
			t.Fatalf("%s invalid historical source identity", row.ID)
		}
		if row.Source.Range.Start <= 0 || row.Source.Range.End < row.Source.Range.Start || len(row.Source.TestLines) == 0 {
			t.Fatalf("%s invalid source range/test lines", row.ID)
		}
		if row.Source.AssertCount != len(row.Source.AssertLines) {
			t.Fatalf("%s assertCount=%d lines=%d", row.ID, row.Source.AssertCount, len(row.Source.AssertLines))
		}
		for _, line := range row.Source.AssertLines {
			if line < row.Source.Range.Start || line > row.Source.Range.End {
				t.Fatalf("%s assertion line %d outside historical range", row.ID, line)
			}
		}
		representedFiles[row.Source.File] = true
		assertionCount += row.Source.AssertCount
		if row.Disposition == "ported-required" || row.Disposition == "selective-port" {
			if len(row.GoTests) == 0 {
				t.Fatalf("%s is %s without Go tests", row.ID, row.Disposition)
			}
			for _, historical := range row.GoTests {
				current := historical
				if renamed, ok := inventoryTestNameAliases[historical]; ok {
					current = renamed
				}
				if !goTestNames[current] {
					t.Fatalf("%s references missing Go test %s (resolved from %s)", row.ID, current, historical)
				}
			}
		}
	}

	if len(representedFiles) != 16 {
		t.Fatalf("represented historical MJS files=%d, want 16", len(representedFiles))
	}
	if assertionCount != 540 {
		t.Fatalf("historical assertion sites=%d, want 540", assertionCount)
	}
	for old, current := range inventoryTestNameAliases {
		if goTestNames[old] || !goTestNames[current] {
			t.Fatalf("test rename %s -> %s is stale", old, current)
		}
	}
	for _, required := range []string{
		"promotion.success-linkage-detachment",
		"proposal.deep-nesting-resource-safety",
	} {
		if !ids[required] {
			t.Fatalf("missing required high-risk meaning %s", required)
		}
	}
	for name := range goTestNames {
		if strings.HasSuffix(name, "_RED") {
			t.Fatalf("stale RED test name after cutover: %s", name)
		}
	}
}
