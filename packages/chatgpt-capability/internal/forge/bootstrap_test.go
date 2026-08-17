package forge

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestInspectBootstrapExposesSelfExtensionAndCapabilities(t *testing.T) {
	dir := t.TempDir()
	bootstrapPath := filepath.Join(dir, "bootstrap.json")
	registryPath := filepath.Join(dir, "registry.jsonl")
	bootstrap := Bootstrap{
		Schema: BootstrapSchema,
		Capforge: ArtifactRef{Kind: "native", Target: "linux-amd64-static", PayloadSHA256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
		SourceKit: SourceKitRef{SHA256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},
	}
	data, err := json.Marshal(bootstrap)
	if err != nil { t.Fatal(err) }
	if err := os.WriteFile(bootstrapPath, data, 0o644); err != nil { t.Fatal(err) }
	record := RegistryRecord{Schema: RegistrySchema, ID: "demo", Status: "active", Title: "Demo", Purpose: "demo extension", Implementation: &ImplementationClaim{Kind: "native", Target: "linux-amd64-static", PayloadSHA256: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc", PayloadBytes: 123, CarrierPath: "./cap/v1/native/linux-amd64-static/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc.b64.txt"}}
	line, _ := json.Marshal(record)
	if err := os.WriteFile(registryPath, append(line, '\n'), 0o644); err != nil { t.Fatal(err) }

	got, err := InspectBootstrap(BootstrapInspectOptions{BootstrapPath: bootstrapPath, RegistryPath: registryPath, ReleaseTag: "cap-1", CapabilityID: "demo"})
	if err != nil { t.Fatal(err) }
	if !got.CanExtend || len(got.SelfExtension) != 2 || len(got.Capabilities) != 1 { t.Fatalf("unexpected inspection: %#v", got) }
	if got.SelfExtension[0].Asset != "carrier.native.linux-amd64-static.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.b64.txt" { t.Fatalf("unexpected capforge request: %#v", got.SelfExtension[0]) }
	if got.SelfExtension[1].Asset != "source-kit.bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.b64.txt" { t.Fatalf("unexpected source kit request: %#v", got.SelfExtension[1]) }
	if got.SelectedRequest == nil || got.SelectedRequest.Asset != "carrier.native.linux-amd64-static.cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc.b64.txt" { t.Fatalf("unexpected selected request: %#v", got.SelectedRequest) }
}

func TestInspectBootstrapRejectsUnknownCapability(t *testing.T) {
	dir := t.TempDir()
	bootstrapPath := filepath.Join(dir, "bootstrap.json")
	registryPath := filepath.Join(dir, "registry.jsonl")
	data, _ := json.Marshal(Bootstrap{Schema: BootstrapSchema, Capforge: ArtifactRef{PayloadSHA256: "a"}, SourceKit: SourceKitRef{SHA256: "b"}})
	if err := os.WriteFile(bootstrapPath, data, 0o644); err != nil { t.Fatal(err) }
	if err := os.WriteFile(registryPath, nil, 0o644); err != nil { t.Fatal(err) }
	if _, err := InspectBootstrap(BootstrapInspectOptions{BootstrapPath: bootstrapPath, RegistryPath: registryPath, CapabilityID: "missing"}); err == nil { t.Fatal("expected missing capability error") }
}
