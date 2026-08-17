package forge

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
)

type BootstrapRequest struct {
	Tag           string `json:"tag"`
	Asset         string `json:"asset"`
	PayloadSHA256 string `json:"payload_sha256"`
}

type BootstrapInspectOptions struct {
	BootstrapPath string
	RegistryPath  string
	ReleaseTag    string
	CapabilityID  string
}

type BootstrapCapability struct {
	ID            string   `json:"id"`
	Title         string   `json:"title,omitempty"`
	Purpose       string   `json:"purpose,omitempty"`
	Tags          []string `json:"tags,omitempty"`
	Kind          string   `json:"kind"`
	Target        string   `json:"target"`
	PayloadSHA256 string   `json:"payloadSha256"`
	PayloadBytes  int64    `json:"payloadBytes"`
	CarrierPath   string   `json:"carrierPath"`
}

type BootstrapInspection struct {
	Schema          string                `json:"schema"`
	Status          string                `json:"status"`
	CanExtend       bool                  `json:"canExtend"`
	Purpose         string                `json:"purpose"`
	Capabilities    []BootstrapCapability `json:"capabilities"`
	SelfExtension   []BootstrapRequest    `json:"selfExtension,omitempty"`
	Selected        *BootstrapCapability  `json:"selected,omitempty"`
	SelectedRequest *BootstrapRequest     `json:"selectedRequest,omitempty"`
}

func InspectBootstrap(options BootstrapInspectOptions) (BootstrapInspection, error) {
	if options.BootstrapPath == "" || options.RegistryPath == "" {
		return BootstrapInspection{}, fmt.Errorf("bootstrap and registry paths are required")
	}
	data, err := os.ReadFile(options.BootstrapPath)
	if err != nil {
		return BootstrapInspection{}, err
	}
	var bootstrap Bootstrap
	if err := json.Unmarshal(data, &bootstrap); err != nil {
		return BootstrapInspection{}, err
	}
	if bootstrap.Schema != BootstrapSchema {
		return BootstrapInspection{}, fmt.Errorf("unsupported bootstrap schema: %q", bootstrap.Schema)
	}
	if bootstrap.Capforge.PayloadSHA256 == "" || bootstrap.SourceKit.SHA256 == "" {
		return BootstrapInspection{}, fmt.Errorf("bootstrap is missing self-extension artifacts")
	}
	capabilities, err := readBootstrapCapabilities(options.RegistryPath)
	if err != nil {
		return BootstrapInspection{}, err
	}
	out := BootstrapInspection{
		Schema:       "capforge-bootstrap-inspection/1",
		Status:       "PASS",
		CanExtend:    true,
		Purpose:      "Materialize Capforge and the source kit from the Release bootstrap, then choose active capabilities from the registry without transporting large binaries through the model.",
		Capabilities: capabilities,
	}
	if options.ReleaseTag != "" {
		out.SelfExtension = []BootstrapRequest{
			releaseCarrierRequest(options.ReleaseTag, bootstrap.Capforge.Kind, bootstrap.Capforge.Target, bootstrap.Capforge.PayloadSHA256),
			{Tag: options.ReleaseTag, Asset: "source-kit." + bootstrap.SourceKit.SHA256 + ".b64.txt", PayloadSHA256: bootstrap.SourceKit.SHA256},
		}
	}
	if options.CapabilityID != "" {
		for i := range capabilities {
			capability := capabilities[i]
			if capability.ID != options.CapabilityID {
				continue
			}
			out.Selected = &capability
			if options.ReleaseTag != "" {
				request := releaseCarrierRequest(options.ReleaseTag, capability.Kind, capability.Target, capability.PayloadSHA256)
				out.SelectedRequest = &request
			}
			return out, nil
		}
		return BootstrapInspection{}, fmt.Errorf("capability not found in active registry: %s", options.CapabilityID)
	}
	return out, nil
}

func readBootstrapCapabilities(path string) ([]BootstrapCapability, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	var result []BootstrapCapability
	scanner := bufio.NewScanner(file)
	buffer := make([]byte, 0, 64*1024)
	scanner.Buffer(buffer, 4*1024*1024)
	for scanner.Scan() {
		var record RegistryRecord
		if err := json.Unmarshal(scanner.Bytes(), &record); err != nil {
			return nil, err
		}
		if record.Status != "active" || record.Implementation == nil || record.Implementation.CarrierPath == "" {
			continue
		}
		impl := record.Implementation
		result = append(result, BootstrapCapability{
			ID: record.ID, Title: record.Title, Purpose: record.Purpose, Tags: record.Tags,
			Kind: impl.Kind, Target: impl.Target, PayloadSHA256: impl.PayloadSHA256, PayloadBytes: impl.PayloadBytes, CarrierPath: impl.CarrierPath,
		})
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func releaseCarrierRequest(tag, kind, target, payloadSHA string) BootstrapRequest {
	return BootstrapRequest{
		Tag:           tag,
		Asset:         fmt.Sprintf("carrier.%s.%s.%s.b64.txt", kind, target, payloadSHA),
		PayloadSHA256: payloadSHA,
	}
}
