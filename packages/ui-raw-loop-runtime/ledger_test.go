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
	return Ledger{Path: filepath.Join(t.TempDir(), "authoring-intent.jsonl"), Now: func() time.Time { return time.Date(2026, 9, 3, 7, 0, 0, 123, time.UTC) }}
}

func TestLedgerAppendAndNoChange(t *testing.T) {
	ledger := fixedLedger(t)
	intent := testIntent("intent-1")
	first, err := ledger.Append(intent)
	if err != nil || first.Status != AppendStatusAppended { t.Fatalf("first Append() = %#v, %v", first, err) }
	second, err := ledger.Append(intent)
	if err != nil || second.Status != AppendStatusNoChange { t.Fatalf("second Append() = %#v, %v", second, err) }
	data, err := os.ReadFile(ledger.Path)
	if err != nil { t.Fatal(err) }
	if !strings.HasSuffix(string(data), "\n") || strings.Count(string(data), "\n") != 1 { t.Fatalf("ledger must contain one complete row: %q", data) }
	records, err := ledger.Read()
	if err != nil { t.Fatal(err) }
	if len(records) != 1 || records[0].Intent.IntentID != "intent-1" { t.Fatalf("unexpected records: %#v", records) }
}

func TestLedgerConflictingIntentIDFailsWithoutSecondRow(t *testing.T) {
	ledger := fixedLedger(t)
	if _, err := ledger.Append(testIntent("intent-1")); err != nil { t.Fatal(err) }
	changed := testIntent("intent-1"); changed.Body = "different body"
	if _, err := ledger.Append(changed); !errors.Is(err, ErrConflict) { t.Fatalf("Append() error = %v, want ErrConflict", err) }
	data, _ := os.ReadFile(ledger.Path)
	if strings.Count(string(data), "\n") != 1 { t.Fatalf("conflict wrote another row: %q", data) }
}

func TestLedgerRejectsTornOrMalformedHistory(t *testing.T) {
	valid := fixedLedger(t)
	if _, err := valid.Append(testIntent("seed")); err != nil { t.Fatal(err) }
	canonical, _ := os.ReadFile(valid.Path)
	nonCanonical := strings.Replace(string(canonical), `{"kind":`, `{ "kind":`, 1)
	for name, existing := range map[string]string{"torn tail": `{"kind":"semantic.intent.accepted.v1"}`, "malformed row": "not-json\n", "noncanonical row": nonCanonical} {
		t.Run(name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "authoring-intent.jsonl")
			if err := os.WriteFile(path, []byte(existing), 0o600); err != nil { t.Fatal(err) }
			ledger := Ledger{Path: path}
			if _, err := ledger.Append(testIntent("intent-2")); !errors.Is(err, ErrCorruptLedger) { t.Fatalf("Append() error = %v", err) }
			data, _ := os.ReadFile(path)
			if string(data) != existing { t.Fatalf("corrupt ledger changed") }
		})
	}
}

func TestLedgerConcurrentAppendsRemainComplete(t *testing.T) {
	ledger := fixedLedger(t)
	const count = 32
	var wait sync.WaitGroup
	errs := make([]error, count)
	for index := 0; index < count; index++ { wait.Add(1); go func(index int) { defer wait.Done(); _, errs[index] = ledger.Append(testIntent(fmt.Sprintf("intent-%02d", index))) }(index) }
	wait.Wait()
	for index, err := range errs { if err != nil { t.Fatalf("append %d failed: %v", index, err) } }
	records, err := ledger.Read()
	if err != nil || len(records) != count { t.Fatalf("records = %d, %v", len(records), err) }
}
