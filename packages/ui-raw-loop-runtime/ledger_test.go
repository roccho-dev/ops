package semanticlog

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func testIntent(intentID string) Intent {
	return Intent{Schema: IntentSchema, IntentID: intentID, TopicID: "ops/374", Kind: IntentKind, Body: "minimum semantic log"}
}

func fixedLedger(t *testing.T) Ledger {
	t.Helper()
	return Ledger{
		Path: filepath.Join(t.TempDir(), "authoring-intent.jsonl"),
		Now: func() time.Time { return time.Date(2026, 9, 3, 7, 0, 0, 123, time.UTC) },
	}
}

func TestLedgerAppendAndNoChange(t *testing.T) {
	ledger := fixedLedger(t)
	intent := testIntent("intent-1")
	first, err := ledger.Append(intent)
	if err != nil || first.Status != AppendStatusAppended {
		t.Fatalf("first = %#v, %v", first, err)
	}
	second, err := ledger.Append(intent)
	if err != nil || second.Status != AppendStatusNoChange {
		t.Fatalf("second = %#v, %v", second, err)
	}
	data, err := os.ReadFile(ledger.Path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(string(data), "\n") || strings.Count(string(data), "\n") != 1 {
		t.Fatalf("ledger row = %q", data)
	}
	records, err := ledger.Read()
	if err != nil || len(records) != 1 || records[0].Intent.IntentID != "intent-1" {
		t.Fatalf("records = %#v, %v", records, err)
	}
	info, err := os.Stat(ledger.Path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("mode = %o", info.Mode().Perm())
	}
}

func TestLedgerConflictDoesNotAppend(t *testing.T) {
	ledger := fixedLedger(t)
	if _, err := ledger.Append(testIntent("intent-1")); err != nil {
		t.Fatal(err)
	}
	changed := testIntent("intent-1")
	changed.Body = "different"
	if _, err := ledger.Append(changed); !errors.Is(err, ErrConflict) {
		t.Fatalf("error = %v", err)
	}
	data, err := os.ReadFile(ledger.Path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Count(string(data), "\n") != 1 {
		t.Fatalf("rows changed: %q", data)
	}
}

func TestLedgerRejectsCorruptHistory(t *testing.T) {
	valid := fixedLedger(t)
	if _, err := valid.Append(testIntent("seed")); err != nil {
		t.Fatal(err)
	}
	canonical, err := os.ReadFile(valid.Path)
	if err != nil {
		t.Fatal(err)
	}
	cases := map[string]string{
		"torn":        `{"kind":"semantic.intent.accepted.v1"}`,
		"malformed":    "not-json\n",
		"noncanonical": strings.Replace(string(canonical), `{"kind":`, `{ "kind":`, 1),
	}
	for name, existing := range cases {
		t.Run(name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "authoring-intent.jsonl")
			if err := os.WriteFile(path, []byte(existing), 0o600); err != nil {
				t.Fatal(err)
			}
			if _, err := (Ledger{Path: path}).Append(testIntent("intent-2")); !errors.Is(err, ErrCorruptLedger) {
				t.Fatalf("error = %v", err)
			}
			data, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if string(data) != existing {
				t.Fatal("corrupt history changed")
			}
		})
	}
}

func TestLedgerConcurrentAppendsRemainComplete(t *testing.T) {
	ledger := fixedLedger(t)
	const count = 32
	var wait sync.WaitGroup
	errs := make([]error, count)
	for i := 0; i < count; i++ {
		wait.Add(1)
		go func(i int) {
			defer wait.Done()
			_, errs[i] = ledger.Append(testIntent(fmt.Sprintf("intent-%02d", i)))
		}(i)
	}
	wait.Wait()
	for i, err := range errs {
		if err != nil {
			t.Fatalf("append %d: %v", i, err)
		}
	}
	records, err := ledger.Read()
	if err != nil || len(records) != count {
		t.Fatalf("records = %d, %v", len(records), err)
	}
}
