package packagedocs

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func writeJSON(t *testing.T, path string, v any) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	b = append(b, '\n')
	if err := os.WriteFile(path, b, 0o644); err != nil {
		t.Fatal(err)
	}
}
func write(t *testing.T, path, value string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(value), 0o644); err != nil {
		t.Fatal(err)
	}
}

func fixture(t *testing.T) (string, SurfaceRoots) {
	t.Helper()
	root := t.TempDir()
	write(t, filepath.Join(root, "build/packages.jsonl"), `{"name":"go-cli","runtime":"go","entry":"packages/go-cli/cmd/go-cli","kind":"package"}
{"name":"node-cli","runtime":"node","entry":"packages/node-cli/bin/node-cli.mjs","kind":"package"}
`)
	for _, spec := range []struct{ id, runtime string }{{"go-cli", "go"}, {"node-cli", "node"}} {
		owner := "packages/" + spec.id
		c := PackageContract{Schema: ContractSchema, PackageID: spec.id, OwnerRoot: owner, Kind: "cli", Responsibility: "Own one deterministic command.", ExternalContracts: []PublicContract{{ID: "cli", EntryPoint: map[string]string{"go": "cmd/go-cli", "node": "bin/node-cli.mjs"}[spec.runtime], Input: "argv", Output: "stdout", Error: "non-zero", Effect: "none", Compatibility: "versioned"}}, InternalContracts: []InternalContract{{ID: "core", Boundary: "Core is isolated from effects.", Invariants: []string{"deterministic"}, ForbiddenEffects: []string{"network"}}}, Documents: []Document{{ID: "package-contract", Kind: "contract-projection", Title: spec.id + " package contract", Path: "docs/package-contract.md", Required: true}}, CurrentConsumers: []string{"proof"}, Projections: []Projection{{ID: "carry", Required: true, Surface: "carry", Path: "share/doc/" + spec.id + "/package-contract.md", Document: "package-contract"}}}
		if spec.id == "go-cli" {
			c.DiscoverRoutes = []CommandRoute{{ID: "help", Required: true, Argv: []string{"./help.sh"}, Contains: []string{"docs/package-contract.md"}}}
			write(t, filepath.Join(root, owner, "help.sh"), "#!/bin/sh\nprintf 'docs/package-contract.md\\n'\n")
			if err := os.Chmod(filepath.Join(root, owner, "help.sh"), 0o755); err != nil {
				t.Fatal(err)
			}
		}
		writeJSON(t, filepath.Join(root, owner, "package.contract.json"), c)
		if err := Project(root, owner); err != nil {
			t.Fatal(err)
		}
	}
	carry := filepath.Join(root, "carry")
	for _, id := range []string{"go-cli", "node-cli"} {
		src := filepath.Join(root, "packages", id, "docs/package-contract.md")
		b, err := os.ReadFile(src)
		if err != nil {
			t.Fatal(err)
		}
		write(t, filepath.Join(carry, "share/doc", id, "package-contract.md"), string(b))
	}
	return root, SurfaceRoots{"carry": carry}
}

func statusMap(obs []Observation) map[string]string {
	m := map[string]string{}
	for _, o := range obs {
		m[o.PackageID+"/"+o.RuleID] = o.Status
	}
	return m
}

func TestLanguageNeutralPassBlockUnknown(t *testing.T) {
	root, surfaces := fixture(t)
	obs, err := Observe(root, filepath.Join(root, "build/packages.jsonl"), "", surfaces)
	if err != nil {
		t.Fatal(err)
	}
	m := statusMap(obs)
	for _, id := range []string{"go-cli", "node-cli"} {
		for _, rule := range []string{RuleIdentity, RuleProjection, RuleDiscovery, RuleDistribution} {
			if m[id+"/"+rule] != "met" {
				t.Fatalf("%s/%s=%s", id, rule, m[id+"/"+rule])
			}
		}
	}
	write(t, filepath.Join(root, "packages/node-cli/docs/package-contract.md"), "drift\n")
	obs, err = Observe(root, filepath.Join(root, "build/packages.jsonl"), "", surfaces)
	if err != nil {
		t.Fatal(err)
	}
	m = statusMap(obs)
	if m["node-cli/"+RuleProjection] != "unmet" {
		t.Fatalf("projection=%s", m["node-cli/"+RuleProjection])
	}
	delete(surfaces, "carry")
	obs, err = Observe(root, filepath.Join(root, "build/packages.jsonl"), "", surfaces)
	if err != nil {
		t.Fatal(err)
	}
	m = statusMap(obs)
	if m["go-cli/"+RuleDistribution] != "unobserved" {
		t.Fatalf("distribution=%s", m["go-cli/"+RuleDistribution])
	}
}

func TestNewCatalogPackageRequiresContract(t *testing.T) {
	root, surfaces := fixture(t)
	baseline := filepath.Join(root, "build/base-packages.jsonl")
	write(t, baseline, `{"name":"go-cli","runtime":"go","entry":"packages/go-cli/cmd/go-cli","kind":"package"}
{"name":"node-cli","runtime":"node","entry":"packages/node-cli/bin/node-cli.mjs","kind":"package"}
`)
	f, err := os.OpenFile(filepath.Join(root, "build/packages.jsonl"), os.O_APPEND|os.O_WRONLY, 0)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = f.WriteString(`{"name":"python-cli","runtime":"python","entry":"packages/python-cli/bin/python-cli","kind":"package"}
`)
	_ = f.Close()
	obs, err := Observe(root, filepath.Join(root, "build/packages.jsonl"), baseline, surfaces)
	if err != nil {
		t.Fatal(err)
	}
	m := statusMap(obs)
	if m["python-cli/"+RuleIdentity] != "unmet" {
		t.Fatalf("missing new contract=%s", m["python-cli/"+RuleIdentity])
	}
}
