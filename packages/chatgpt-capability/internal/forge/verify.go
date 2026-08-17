package forge

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type VerifyReceipt struct {
	Schema          string            `json:"schema"`
	Status          string            `json:"status"`
	RegistryCount   int               `json:"registryCount"`
	ActiveCount     int               `json:"activeCount"`
	CarrierCount    int               `json:"carrierCount"`
	NativeRunCount  int               `json:"nativeRunCount"`
	WASMCount       int               `json:"wasmCount"`
	ProjectionCount int               `json:"projectionCount"`
	SourceKitStatus string            `json:"sourceKitStatus"`
	RootStaticLinks string            `json:"rootStaticLinks"`
	Checks          map[string]string `json:"checks"`
	Errors          []string          `json:"errors,omitempty"`
}

func VerifyDist(dist string) (VerifyReceipt, error) {
	receipt := VerifyReceipt{Schema: "capforge-verify/1", Status: "PASS", Checks: map[string]string{}}
	bootstrapData, err := os.ReadFile(filepath.Join(dist, ".well-known", "bootstrap.json"))
	if err != nil {
		return receipt, err
	}
	var bootstrap Bootstrap
	if err := json.Unmarshal(bootstrapData, &bootstrap); err != nil {
		return receipt, err
	}
	registry, err := readJSONLFile[RegistryRecord](filepath.Join(dist, ".well-known", "registry.jsonl"))
	if err != nil {
		return receipt, err
	}
	receipt.RegistryCount = len(registry)

	indexData, err := os.ReadFile(filepath.Join(dist, "index.html"))
	if err != nil {
		return receipt, err
	}
	indexText := string(indexData)
	for _, required := range []string{"./agent.html", "./.well-known/bootstrap.json", "./.well-known/registry.jsonl", "./ADD.md"} {
		if !strings.Contains(indexText, required) {
			receipt.Errors = append(receipt.Errors, "root missing static link: "+required)
		}
	}
	if len(receipt.Errors) == 0 {
		receipt.RootStaticLinks = "PASS"
	} else {
		receipt.RootStaticLinks = "FAIL"
	}

	for _, record := range registry {
		if record.Status == "active" {
			receipt.ActiveCount++
		}
		if record.Status == "drift" || record.Status == "unobserved" {
			receipt.Errors = append(receipt.Errors, record.ID+": registry status "+record.Status)
		}
		impl := record.Implementation
		if impl != nil && impl.Projection != nil {
			if impl.Projection.Status != "PASS" {
				receipt.Errors = append(receipt.Errors, record.ID+": projection status "+impl.Projection.Status)
			} else {
				receipt.ProjectionCount++
				for rel, expectedSHA := range impl.Projection.Outputs {
					path := filepath.Join(dist, filepath.FromSlash(strings.TrimPrefix(rel, "./")))
					if !pathWithin(dist, path) {
						receipt.Errors = append(receipt.Errors, record.ID+": projection path escapes dist: "+rel)
						continue
					}
					actualSHA, _, err := fileSHA(path)
					if err != nil || actualSHA != expectedSHA {
						receipt.Errors = append(receipt.Errors, record.ID+": projection integrity mismatch: "+rel)
					}
				}
			}
		}
		if impl == nil || impl.CarrierPath == "" {
			continue
		}
		carrierPath := filepath.Join(dist, filepath.FromSlash(strings.TrimPrefix(impl.CarrierPath, "./")))
		carrierText, err := os.ReadFile(carrierPath)
		if err != nil {
			receipt.Errors = append(receipt.Errors, record.ID+": carrier read: "+err.Error())
			continue
		}
		payload, err := strictBase64Decode(string(carrierText))
		if err != nil {
			receipt.Errors = append(receipt.Errors, record.ID+": "+err.Error())
			continue
		}
		if int64(len(payload)) != impl.PayloadBytes || shaHex(payload) != impl.PayloadSHA256 {
			receipt.Errors = append(receipt.Errors, record.ID+": payload integrity mismatch")
			continue
		}
		receipt.CarrierCount++
		if impl.Kind == "native" && record.Status == "active" {
			if len(payload) < 20 || !bytes.Equal(payload[:4], []byte{0x7f, 'E', 'L', 'F'}) || payload[4] != 2 || payload[5] != 1 || payload[18] != 0x3e || payload[19] != 0x00 {
				receipt.Errors = append(receipt.Errors, record.ID+": not ELF64 little-endian x86-64")
				continue
			}
			tmpDir, err := os.MkdirTemp("", "capforge-verify-*")
			if err != nil {
				return receipt, err
			}
			tmp := filepath.Join(tmpDir, record.ID)
			if err := os.WriteFile(tmp, payload, 0o755); err != nil {
				os.RemoveAll(tmpDir)
				return receipt, err
			}
			if impl.Fixture != nil {
				result := runFixture(tmp, impl.Fixture)
				if result.Status != "PASS" {
					receipt.Errors = append(receipt.Errors, record.ID+": restored native fixture failed")
				} else {
					receipt.NativeRunCount++
				}
			}
			_ = os.RemoveAll(tmpDir)
		}
		if impl.Kind == "wasm" {
			if len(payload) < 8 || !bytes.Equal(payload[:4], []byte{0x00, 0x61, 0x73, 0x6d}) {
				receipt.Errors = append(receipt.Errors, record.ID+": invalid WASM magic")
			} else {
				receipt.WASMCount++
			}
			if impl.RawPath != "" {
				rawPath := filepath.Join(dist, filepath.FromSlash(strings.TrimPrefix(impl.RawPath, "./")))
				raw, err := os.ReadFile(rawPath)
				if err != nil || !bytes.Equal(raw, payload) {
					receipt.Errors = append(receipt.Errors, record.ID+": raw/carrier mismatch")
				}
			}
		}
	}

	kitCarrierPath := filepath.Join(dist, filepath.FromSlash(strings.TrimPrefix(bootstrap.SourceKit.CarrierPath, "./")))
	kitCarrier, err := os.ReadFile(kitCarrierPath)
	if err != nil {
		receipt.Errors = append(receipt.Errors, "source kit carrier: "+err.Error())
	} else if kitBytes, err := strictBase64Decode(string(kitCarrier)); err != nil {
		receipt.Errors = append(receipt.Errors, "source kit decode: "+err.Error())
	} else if int64(len(kitBytes)) != bootstrap.SourceKit.Bytes || shaHex(kitBytes) != bootstrap.SourceKit.SHA256 {
		receipt.Errors = append(receipt.Errors, "source kit integrity mismatch")
	} else {
		rawPath := filepath.Join(dist, filepath.FromSlash(strings.TrimPrefix(bootstrap.SourceKit.RawPath, "./")))
		raw, err := os.ReadFile(rawPath)
		if err != nil || !bytes.Equal(raw, kitBytes) {
			receipt.Errors = append(receipt.Errors, "source kit raw/carrier mismatch")
		} else {
			receipt.SourceKitStatus = "PASS"
		}
	}

	if len(receipt.Errors) > 0 {
		receipt.Status = "FAIL"
	}
	receipt.Checks["carrier"] = fmt.Sprintf("%d", receipt.CarrierCount)
	receipt.Checks["nativeRuns"] = fmt.Sprintf("%d", receipt.NativeRunCount)
	receipt.Checks["wasm"] = fmt.Sprintf("%d", receipt.WASMCount)
	receipt.Checks["projections"] = fmt.Sprintf("%d", receipt.ProjectionCount)
	return receipt, nil
}

func Materialize(carrierPath, expectedSHA, output string, executable bool) error {
	text, err := os.ReadFile(carrierPath)
	if err != nil {
		return err
	}
	payload, err := strictBase64Decode(string(text))
	if err != nil {
		return err
	}
	actual := shaHex(payload)
	if actual != expectedSHA {
		return fmt.Errorf("SHA-256 mismatch: expected %s, got %s", expectedSHA, actual)
	}
	mode := os.FileMode(0o644)
	if executable {
		mode = 0o755
	}
	return writeFile(output, payload, mode)
}
