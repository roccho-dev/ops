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

func testIntent(eventID string) Intent {
	return Intent{
		Schema:  IntentSchema,
		EventID: eventID,
		TopicID: "ops/374",
		Kind:    "note",
		Body:    "minimum semantic log",
	}
}

func fixedLedger(t *testing.T) Ledger {
	t.Helper()
	return Ledger{
		Path: filepath.Join(t.TempDir(), "authoring-intent.jsonl"),
		Now: func() time.Time {
			return time.Date(2026, 9, 3, 7, 0, 0, 123, time.UTC)
		},
	}
}

func TestLedgerAppendAndNoChange(t *testing.T) {
	ledger := fixedLedger(t)
	intent := testIntent("event-1")

	first, err := ledger.Append(intent)
	if err != nil {
		t.Fatalf("first Append() error = %v", err)
	}
	if first.Status != AppendStatusAppended {
		t.Fatalf("first status = %q", first.Status)
	}
	second, err := ledger.Append(intent)
	if err != nil {
		t.Fatalf("second Append() error = %v", err)
	}
	if second.Status != AppendStatusNoChange {
		t.Fatalf("second status = %q", second.Status)
	}

	data, err := os.ReadFile(ledger.Path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(string(data), "\n") || strings.Count(string(data), "\n") != 1 {
		t.Fatalf("ledger must contain one complete row: %q", data)
	}
	records, err := ledger.Read()
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 1 || records[0].Intent.EventID != "event-1" {
		t.Fatalf("unexpected records: %#v", records)
	}
	info, err := os.Stat(ledger.Path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("ledger mode = %o, want 600", info.Mode().Perm())
	}
}

func TestLedgerConflictingEventIDFailsWithoutSecondRow(t *testing.T) {
	ledger := fixedLedger(t)
	if _, err := ledger.Append(testIntent("event-1")); err != nil {
		t.Fatal(err)
	}
	changed := testIntent("event-1")
	changed.Body = "different body"
	if _, err := ledger.Append(changed); !errors.Is(err, ErrConflict) {
		t.Fatalf("Append() error = %v, want ErrConflict", err)
	}
	data, err := os.ReadFile(ledger.Path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Count(string(data), "\n") != 1 {
		t.Fatalf("conflict wrote another row: %q", data)
	}
}

func TestLedgerRejectsTornOrMalformedHistory(t *testing.T) {
	valid := fixedLedger(t)
	if _, err := valid.Append(testIntent("seed")); err != nil {
		t.Fatal(err)
	}
	canonical, err := os.ReadFile(valid.Path)
	if err != nil {
		t.Fatal(err)
	}
	nonCanonical := strings.Replace(string(canonical), `{"kind":`, `{ "kind":`, 1)
	tests := map[string]string{
		"torn tail":        `{"kind":"semantic.intent.accepted.v1"}`,
		"malformed row":    "not-json\n",
		"noncanonical row": nonCanonical,
	}
	for name, existing := range tests {
		t.Run(name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "authoring-intent.jsonl")
			if err := os.WriteFile(path, []byte(existing), 0o600); err != nil {
				t.Fatal(err)
			}
			ledger := Ledger{Path: path}
			if _, err := ledger.Append(testIntent("event-2")); !errors.Is(err, ErrCorruptLedger) {
				t.Fatalf("Append() error = %v, want ErrCorruptLedger", err)
			}
			data, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if string(data) != existing {
				t.Fatalf("corrupt ledger changed: got %q want %q", data, existing)
			}
		})
	}
}

func TestLedgerConcurrentAppendsRemainComplete(t *testing.T) {
	ledger := fixedLedger(t)
	const count = 32
	var wait sync.WaitGroup
	errorsByIndex := make([]error, count)
	for index := 0; index < count; index++ {
		wait.Add(1)
		go func(index int) {
			defer wait.Done()
			_, errorsByIndex[index] = ledger.Append(testIntent(fmt.Sprintf("event-%02d", index)))
		}(index)
	}
	wait.Wait()
	for index, err := range errorsByIndex {
		if err != nil {
			t.Fatalf("append %d failed: %v", index, err)
		}
	}
	records, err := ledger.Read()
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != count {
		t.Fatalf("record count = %d, want %d", len(records), count)
	}
	data, err := os.ReadFile(ledger.Path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Count(string(data), "\n") != count {
		t.Fatalf("newline count = %d, want %d", strings.Count(string(data), "\n"), count)
	}
}
