package hq

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
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
	Schema, ID, Disposition string
	GoTests                 []string `json:"goTests"`
	Source                  struct {
		File                   string `json:"file"`
		AssertLines, TestLines []int
		AssertCount            int
		SHA256                 string `json:"sha256"`
		Range                  struct{ Start, End int }
	}
}

func proofRepoRootForTest(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("caller")
	}
	return filepath.Clean(filepath.Join(filepath.Dir(file), "..", "..", "..", ".."))
}

func readTestMeaningInventory(t *testing.T, dir string) []testMeaningInventoryRow {
	t.Helper()
	paths, err := filepath.Glob(filepath.Join(dir, "*.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	if len(paths) != 16 {
		t.Fatalf("shards=%d", len(paths))
	}
	sort.Strings(paths)
	rows := []testMeaningInventoryRow{}
	for _, path := range paths {
		f, err := os.Open(path)
		if err != nil {
			t.Fatal(err)
		}
		s := bufio.NewScanner(f)
		s.Buffer(make([]byte, 64<<10), 4<<20)
		for line := 1; s.Scan(); line++ {
			var row testMeaningInventoryRow
			if err := json.Unmarshal(s.Bytes(), &row); err != nil {
				f.Close()
				t.Fatalf("%s:%d: %v", path, line, err)
			}
			rows = append(rows, row)
		}
		if err := s.Err(); err != nil {
			f.Close()
			t.Fatal(err)
		}
		if err := f.Close(); err != nil {
			t.Fatal(err)
		}
	}
	return rows
}

func TestCanonicalTestMeaningInventoryIsComplete(t *testing.T) {
	root := proofRepoRootForTest(t)
	inventoryDir := filepath.Join(root, "packages", "hq-modeling-runtime-go-proof", "test-meaning.inventory")
	nodeDir := filepath.Join(root, "packages", "hq-modeling-runtime", "tests")
	rows := readTestMeaningInventory(t, inventoryDir)
	if len(rows) != 154 {
		t.Fatalf("meanings=%d", len(rows))
	}
	assertRE := regexp.MustCompile(`\bassert\.(equal|deepEqual|notStrictEqual|match|ok|throws|doesNotThrow|notEqual|fail)\s*\(`)
	testRE := regexp.MustCompile(`(?m)^func (Test[[:alnum:]_]+)\s*\(`)
	allowed := map[string]bool{"ported-required": true, "selective-port": true, "retained-node-only": true, "deferred-outside-proof": true, "canonical-node-package-only": true, "retained-existing-parity": true}

	goTests := map[string]bool{}
	files, err := filepath.Glob(filepath.Join(filepath.Dir(inventoryDir), "internal", "hq", "*_test.go"))
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range files {
		b, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		for _, m := range testRE.FindAllSubmatch(b, -1) {
			goTests[string(m[1])] = true
		}
	}

	assertions := map[string]map[int]bool{}
	nodeFiles, err := filepath.Glob(filepath.Join(nodeDir, "*.mjs"))
	if err != nil {
		t.Fatal(err)
	}
	if len(nodeFiles) != 16 {
		t.Fatalf("mjs=%d", len(nodeFiles))
	}
	for _, path := range nodeFiles {
		b, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		name := filepath.Base(path)
		assertions[name] = map[int]bool{}
		for i, line := range strings.Split(string(b), "\n") {
			if assertRE.MatchString(line) {
				assertions[name][i+1] = true
			}
		}
	}

	ids, represented := map[string]bool{}, map[string]bool{}
	covered := map[string]map[int][]string{}
	for _, row := range rows {
		if row.Schema != "hq.modelingRuntime.goTestMeaning.v1" || row.ID == "" || ids[row.ID] || !allowed[row.Disposition] {
			t.Fatalf("invalid inventory row %s", row.ID)
		}
		ids[row.ID] = true
		if row.Source.Range.Start <= 0 || row.Source.Range.End < row.Source.Range.Start || len(row.Source.TestLines) == 0 || row.Source.AssertCount != len(row.Source.AssertLines) {
			t.Fatalf("invalid source %s", row.ID)
		}
		path := filepath.Join(nodeDir, row.Source.File)
		b, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		sum := sha256.Sum256(b)
		if hex.EncodeToString(sum[:]) != row.Source.SHA256 {
			t.Fatalf("stale %s", row.Source.File)
		}
		represented[row.Source.File] = true
		if covered[row.Source.File] == nil {
			covered[row.Source.File] = map[int][]string{}
		}
		for _, line := range row.Source.AssertLines {
			if line < row.Source.Range.Start || line > row.Source.Range.End || !assertions[row.Source.File][line] {
				t.Fatalf("bad assertion %s:%d", row.Source.File, line)
			}
			covered[row.Source.File][line] = append(covered[row.Source.File][line], row.ID)
		}
		if row.Disposition == "ported-required" || row.Disposition == "selective-port" {
			if len(row.GoTests) == 0 {
				t.Fatalf("unowned %s", row.ID)
			}
			for _, old := range row.GoTests {
				name := old
				if current, ok := inventoryTestNameAliases[old]; ok {
					name = current
				}
				if !goTests[name] {
					t.Fatalf("%s -> %s missing", old, name)
				}
			}
		}
	}
	for old, current := range inventoryTestNameAliases {
		if goTests[old] || !goTests[current] {
			t.Fatalf("rename %s -> %s invalid", old, current)
		}
	}
	if len(represented) != 16 {
		t.Fatalf("represented=%d", len(represented))
	}
	count := 0
	for file, lines := range assertions {
		for line := range lines {
			count++
			if len(covered[file][line]) != 1 {
				t.Fatalf("owners %s:%d=%v", file, line, covered[file][line])
			}
		}
	}
	if count != 540 {
		t.Fatalf("assertions=%d", count)
	}
	for _, id := range []string{"promotion.success-linkage-detachment", "proposal.deep-nesting-resource-safety"} {
		if !ids[id] {
			t.Fatalf("missing %s", id)
		}
	}
	for name := range goTests {
		if strings.HasSuffix(name, "_RED") {
			t.Fatalf("stale %s", name)
		}
	}
}
