package admission

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestVerifySourceManifestRejectsTampering(t *testing.T) {
	root := t.TempDir()
	file := filepath.Join(root, "adapter.py")
	if err := os.WriteFile(file, []byte("print('clean')\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	files, err := regularFileHashes(root)
	if err != nil {
		t.Fatal(err)
	}
	manifest := canonicalManifest(files)
	if err := os.WriteFile(filepath.Join(root, "SHA256SUMS"), manifest, 0o644); err != nil {
		t.Fatal(err)
	}
	expected := "sha256:" + shaHex(manifest)
	if _, err := verifySourceManifest(root, expected); err != nil {
		t.Fatalf("clean manifest failed: %v", err)
	}
	if err := os.WriteFile(file, []byte("print('tampered')\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := verifySourceManifest(root, expected); err == nil || !strings.Contains(err.Error(), "SOURCE_FILE_SHA256_MISMATCH") {
		t.Fatalf("tampered file was not rejected correctly: %v", err)
	}
}

func TestLocalPolicyIdentityCannotBecomeFormal(t *testing.T) {
	ref := "local-policy-sha256:" + strings.Repeat("a", 64)
	if err := ValidatePolicyRef(ref); err != nil {
		t.Fatalf("local policy should be valid for local admission: %v", err)
	}
	if err := ValidateExactPolicyRef(ref); err == nil || !strings.Contains(err.Error(), "MUTABLE_POLICY_REF") {
		t.Fatalf("local policy was accepted as formal: %v", err)
	}
}

func TestDirectoryTreeRefIsContentDeterministic(t *testing.T) {
	left := t.TempDir()
	right := t.TempDir()
	for _, root := range []string{left, right} {
		if err := os.MkdirAll(filepath.Join(root, "src"), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(root, "src", "core.py"), []byte("VALUE = 42\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	leftRef, err := directoryTreeRef(left)
	if err != nil {
		t.Fatal(err)
	}
	rightRef, err := directoryTreeRef(right)
	if err != nil {
		t.Fatal(err)
	}
	if leftRef != rightRef {
		t.Fatalf("same content produced different refs: %s != %s", leftRef, rightRef)
	}
	if err := os.WriteFile(filepath.Join(right, "src", "core.py"), []byte("VALUE = 43\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	changedRef, err := directoryTreeRef(right)
	if err != nil {
		t.Fatal(err)
	}
	if changedRef == leftRef {
		t.Fatal("changed content did not change directory tree identity")
	}
}

func TestLocalIntakeReceiptDetectsTampering(t *testing.T) {
	receipt, err := finalizeLocalIntakeReceipt(LocalIntakeReceipt{
		Schema:        localIntakeSchema,
		Status:        "PASS",
		SourceKind:    "actions-artifact",
		SourceID:      "123",
		SourceSHA256:  "sha256:" + strings.Repeat("1", 64),
		PolicyRef:     strings.Repeat("a", 40),
		PolicyHash:    "sha256:" + strings.Repeat("2", 64),
		RuntimeSHA256: "sha256:" + strings.Repeat("3", 64),
		PolicyPath:    "policy",
		AdaptersPath:  "adapters",
		RuntimePath:   "bin/policyctl",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := validateLocalIntakeReceipt(receipt); err != nil {
		t.Fatalf("clean receipt failed: %v", err)
	}
	receipt.SourceID = "124"
	if err := validateLocalIntakeReceipt(receipt); err == nil || !strings.Contains(err.Error(), "INTAKE_RECEIPT_DIGEST_MISMATCH") {
		t.Fatalf("tampered receipt was not rejected: %v", err)
	}
}
