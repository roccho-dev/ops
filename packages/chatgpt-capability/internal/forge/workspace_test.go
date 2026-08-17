package forge

import (
	"os"
	"path/filepath"
	"testing"
)

func TestAddCapabilityTouchesOnlyOwnDecisionAndDirectory(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "go.mod"), []byte("module test.local\n\ngo 1.23\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := AddCapability(AddOptions{Root: root, ID: "go-demo", Title: "Demo", Purpose: "proof", Message: "ok"}); err != nil {
		t.Fatal(err)
	}
	for _, rel := range []string{"decisions/go-demo.jsonl", "capabilities/go-demo/main.go", "capabilities/go-demo/fixture.json"} {
		if _, err := os.Stat(filepath.Join(root, rel)); err != nil {
			t.Fatalf("missing %s: %v", rel, err)
		}
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 3 { // go.mod, decisions, capabilities
		t.Fatalf("unexpected central writes: %d entries", len(entries))
	}
}

func TestDecisionClaimIDMustMatchFilename(t *testing.T) {
	root := t.TempDir()
	decisionDir := filepath.Join(root, "decisions")
	if err := os.MkdirAll(decisionDir, 0o755); err != nil {
		t.Fatal(err)
	}
	line := `{"schema":"capability-decision/1","id":"other","action":"adopt"}` + "\n"
	if err := os.WriteFile(filepath.Join(decisionDir, "expected.jsonl"), []byte(line), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, _, err := loadDecisions(root); err == nil {
		t.Fatal("accepted decision claim whose id does not match its filename")
	}
}
