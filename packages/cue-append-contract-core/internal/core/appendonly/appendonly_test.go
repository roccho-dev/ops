package appendonly

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCheckAcceptsPureAppend(t *testing.T) {
	dir := t.TempDir()
	base := filepath.Join(dir, "base.jsonl")
	candidate := filepath.Join(dir, "candidate.jsonl")
	write(t, base, "{\"event_id\":\"evt_one\"}\n{\"event_id\":\"evt_two\"}\n")
	write(t, candidate, "{\"event_id\":\"evt_one\"}\n{\"event_id\":\"evt_two\"}\n{\"event_id\":\"evt_three\"}\n")
	res, err := Check(base, candidate)
	if err != nil {
		t.Fatal(err)
	}
	if res.PrefixLines != 2 || res.BaseLines != 2 || res.LedgerLines != 3 || res.Status != "pass" {
		t.Fatalf("unexpected append-only result: %+v", res)
	}
}

func TestCheckRejectsRewrite(t *testing.T) {
	dir := t.TempDir()
	base := filepath.Join(dir, "base.jsonl")
	candidate := filepath.Join(dir, "candidate.jsonl")
	write(t, base, "{\"event_id\":\"evt_one\"}\n{\"event_id\":\"evt_two\"}\n")
	write(t, candidate, "{\"event_id\":\"evt_one_rewritten\"}\n{\"event_id\":\"evt_two\"}\n")
	_, err := Check(base, candidate)
	if err == nil || !strings.Contains(err.Error(), "prefix mismatch") {
		t.Fatalf("expected prefix mismatch, got %v", err)
	}
}

func write(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
}
