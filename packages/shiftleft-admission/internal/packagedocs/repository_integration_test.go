package packagedocs

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

type gateReceipt struct {
	Verdict       string `json:"verdict"`
	TerminalState string `json:"terminalState"`
	Counts        struct {
		RequiredUnobserved int `json:"requiredUnobserved"`
		BlockerCount       int `json:"blockerCount"`
	} `json:"counts"`
}

func findRepositoryRoot(t *testing.T) string {
	t.Helper()
	cwd, err := os.Getwd()
	if err != nil { t.Fatal(err) }
	for dir := cwd; ; dir = filepath.Dir(dir) {
		if _, err := os.Stat(filepath.Join(dir, "build", "packages.jsonl")); err == nil {
			if _, err := os.Stat(filepath.Join(dir, "packages", "shiftleft-admission", "cmd", "policyctl")); err == nil { return dir }
		}
		next := filepath.Dir(dir)
		if next == dir { break }
	}
	t.Skip("full repository checkout is required for integration proof")
	return ""
}

func copyFile(t *testing.T, src, dst string) {
	t.Helper(); b, err := os.ReadFile(src); if err != nil { t.Fatal(err) }
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil { t.Fatal(err) }
	if err := os.WriteFile(dst, b, 0o644); err != nil { t.Fatal(err) }
}

func materializeSurfaces(t *testing.T, repo string) SurfaceRoots {
	t.Helper(); roots := SurfaceRoots{"nix": filepath.Join(t.TempDir(), "nix"), "carry": filepath.Join(t.TempDir(), "carry")}
	c, _, err := readContract(filepath.Join(repo, "packages", "shiftleft-admission", "package.contract.json")); if err != nil { t.Fatal(err) }
	docs := documentMap(c)
	for _, p := range c.Projections {
		d := docs[p.Document]
		copyFile(t, filepath.Join(repo, c.OwnerRoot, d.Path), filepath.Join(roots[p.Surface], p.Path))
	}
	return roots
}

func buildPolicyctl(t *testing.T, repo string) string {
	t.Helper(); out := filepath.Join(t.TempDir(), "policyctl")
	cmd := exec.Command("go", "build", "-trimpath", "-o", out, "./cmd/policyctl")
	cmd.Dir = filepath.Join(repo, "packages", "shiftleft-admission")
	if b, err := cmd.CombinedOutput(); err != nil { t.Fatalf("build policyctl: %v\n%s", err, b) }
	return out
}

func runGate(t *testing.T, policyctl, bundle, observations, receipt string, wantSuccess bool) gateReceipt {
	t.Helper()
	hashCmd := exec.Command(policyctl, "hash", "--bundle", bundle)
	hashBytes, err := hashCmd.CombinedOutput(); if err != nil { t.Fatalf("policy hash: %v\n%s", err, hashBytes) }
	hash := strings.TrimSpace(string(hashBytes))
	cmd := exec.Command(policyctl, "admit", "--bundle", bundle, "--policy-ref", strings.Repeat("a", 40), "--policy-sha256", hash, "--base-tree", "git-tree-sha1:"+strings.Repeat("0",40), "--candidate-tree", "git-tree-sha1:"+strings.Repeat("1",40), "--observations", observations, "--out", receipt)
	b, runErr := cmd.CombinedOutput()
	if wantSuccess && runErr != nil { t.Fatalf("expected PASS: %v\n%s", runErr, b) }
	if !wantSuccess && runErr == nil { t.Fatalf("expected blocked Gate: %s", b) }
	data, err := os.ReadFile(receipt); if err != nil { t.Fatal(err) }
	var r gateReceipt; if err := json.Unmarshal(data, &r); err != nil { t.Fatal(err) }
	return r
}

func TestRepositoryPackageDocsUseExistingGate(t *testing.T) {
	repo := findRepositoryRoot(t)
	for _, owner := range []string{"packages/shiftleft-admission", "packages/ops-refs-vault"} {
		c, _, err := readContract(filepath.Join(repo, owner, "package.contract.json")); if err != nil { t.Fatal(err) }
		for _, d := range c.Documents { if d.Kind == "contract-projection" { got, err := os.ReadFile(filepath.Join(repo, owner, d.Path)); if err != nil { t.Fatal(err) }; if string(got) != string(RenderContractMarkdown(c,d)) { t.Fatalf("projection drift: %s/%s", c.PackageID,d.ID) } } }
	}
	policyctl := buildPolicyctl(t, repo)
	bundle := filepath.Join(repo, "packages", "shiftleft-admission", "policy", "package-docs")
	catalog := filepath.Join(repo, "build", "packages.jsonl")
	roots := materializeSurfaces(t, repo)
	observations := filepath.Join(t.TempDir(), "pass.jsonl")
	obs, err := Observe(repo, catalog, "", roots); if err != nil { t.Fatal(err) }
	if err := WriteObservations(observations, obs); err != nil { t.Fatal(err) }
	pass := runGate(t, policyctl, bundle, observations, filepath.Join(t.TempDir(), "pass-receipt.json"), true)
	if pass.Verdict != "PASS" || pass.Counts.RequiredUnobserved != 0 { t.Fatalf("pass receipt: %+v", pass) }

	copyFile(t, filepath.Join(repo, "packages/shiftleft-admission/docs/nway-runbook.md"), filepath.Join(roots["carry"], "share/doc/shiftleft-admission/nway-runbook.md"))
	if err := os.WriteFile(filepath.Join(roots["carry"], "share/doc/shiftleft-admission/nway-runbook.md"), []byte("drift\n"), 0o644); err != nil { t.Fatal(err) }
	observations = filepath.Join(t.TempDir(), "block.jsonl")
	obs, err = Observe(repo, catalog, "", roots); if err != nil { t.Fatal(err) }
	if err := WriteObservations(observations, obs); err != nil { t.Fatal(err) }
	block := runGate(t, policyctl, bundle, observations, filepath.Join(t.TempDir(), "block-receipt.json"), false)
	if block.Verdict != "BLOCK" || block.Counts.BlockerCount == 0 { t.Fatalf("block receipt: %+v", block) }

	observations = filepath.Join(t.TempDir(), "unknown.jsonl")
	obs, err = Observe(repo, catalog, "", SurfaceRoots{}); if err != nil { t.Fatal(err) }
	if err := WriteObservations(observations, obs); err != nil { t.Fatal(err) }
	unknown := runGate(t, policyctl, bundle, observations, filepath.Join(t.TempDir(), "unknown-receipt.json"), false)
	if unknown.Verdict != "BLOCK" || unknown.Counts.RequiredUnobserved == 0 { t.Fatalf("unknown receipt: %+v", unknown) }
}
